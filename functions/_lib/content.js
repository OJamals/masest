import { CONTENT_TYPE_DEFINITIONS, validateStructuredPayload } from "../../js/content-types.js";

export const CONTENT_TYPES = new Set([
  ...Object.keys(CONTENT_TYPE_DEFINITIONS),
]);

export const CONTENT_STATUSES = new Set([
  "draft",
  "published",
  "archived",
  "in_review",
  "changes_requested",
  "scheduled",
]);
export const CONTENT_LOCK_TTL_MS = 30 * 60 * 1000;

export function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function activeContentLock(entry = {}, nowMs = Date.now()) {
  const row = entry || {};
  if (!row.locked_by || !row.locked_at) return false;
  const lockedAt = new Date(row.locked_at).getTime();
  if (Number.isNaN(lockedAt)) return false;
  return nowMs - lockedAt <= CONTENT_LOCK_TTL_MS;
}

function contentLockConflict(entry = {}, userId, { force = false } = {}) {
  const row = entry || {};
  if (force || !activeContentLock(row)) return null;
  const lockedBy = String(row.locked_by || "");
  if (!lockedBy || lockedBy === String(userId || "")) return null;
  return {
    ok: false,
    error: "content_locked",
    message: "This entry is locked by another editor. Force unlock it or wait for the lock to expire.",
    locked_by: row.locked_by,
    locked_at: row.locked_at,
  };
}

function unsafeAssetReference(value) {
  const compact = String(value || "").trim().replace(/[\u0000-\u001F\u007F\s]+/g, "");
  return /^(?:javascript|data|vbscript):/i.test(compact);
}

export function normalizeContentEntry(input = {}) {
  const type = String(input.type || "").trim();
  const status = String(input.status || "draft").trim();
  const title = String(input.title || "").trim();
  const slug = normalizeSlug(input.slug || title);
  return compactRow({
    id: input.id || undefined,
    type,
    slug,
    title,
    status,
    locale: String(input.locale || "en").trim() || "en",
    payload: objectValue(input.payload),
    seo: objectValue(input.seo),
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
  });
}

export function validateContentEntry(input = {}) {
  const entry = normalizeContentEntry(input);
  if (!CONTENT_TYPES.has(entry.type)) return { ok: false, error: `Unsupported content type: ${entry.type}` };
  if (!CONTENT_STATUSES.has(entry.status)) return { ok: false, error: `Unsupported content status: ${entry.status}` };
  if (!entry.slug) return { ok: false, error: "slug_required" };
  if (!entry.title) return { ok: false, error: "title_required" };
  if (!entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) {
    return { ok: false, error: "payload_object_required" };
  }
  const structured = validateStructuredPayload(entry.type, entry.payload);
  if (!structured.ok) return structured;
  entry.payload = structured.payload;
  return { ok: true, entry };
}

export function publicContentSnapshot(entries = []) {
  return entries
    .filter((entry) => entry.status === "published")
    .reduce((acc, entry) => {
      const bucket = acc[entry.type] || [];
      bucket.push({
        type: entry.type,
        slug: entry.slug,
        title: entry.title,
        locale: entry.locale,
        payload: objectValue(entry.payload),
        seo: objectValue(entry.seo),
      });
      acc[entry.type] = bucket;
      return acc;
    }, {});
}

function contentPublishHookUrl(env = {}) {
  return String(
    env.CONTENT_PUBLISH_HOOK_URL
      || env.CLOUDFLARE_PAGES_DEPLOY_HOOK_URL
      || env.CF_PAGES_DEPLOY_HOOK_URL
      || "",
  ).trim();
}

export async function triggerContentPublishBuild(env = {}, entry = {}, fetchImpl = fetch) {
  const hookUrl = contentPublishHookUrl(env);
  if (!hookUrl) return { ok: true, skipped: true };

  try {
    const response = await fetchImpl(hookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "cms_publish",
        type: entry.type || "",
        slug: entry.slug || "",
        locale: entry.locale || "en",
        status: entry.status || "published",
        version: Number.isFinite(Number(entry.version)) ? Number(entry.version) : null,
      }),
    });
    if (response.ok) return { ok: true, skipped: false, status: response.status };
    return { ok: false, skipped: false, status: response.status, error: "deploy_hook_failed" };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: "deploy_hook_failed",
      message: String(error?.message || error || "unknown error"),
    };
  }
}

async function existingEntry(sb, { type, slug, locale }) {
  const { data, error } = await sb
    .from("content_entries")
    .select("*")
    .eq("type", type)
    .eq("slug", slug)
    .eq("locale", locale)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function writeRevision(sb, entry, userId, note) {
  if (!entry?.id) return;
  const { error } = await sb.from("content_revisions").insert({
    entry_id: entry.id,
    version: entry.version,
    status: entry.status,
    payload: objectValue(entry.payload),
    seo: objectValue(entry.seo),
    note: note || null,
    author_id: userId || null,
  });
  if (error) throw error;
}

export function createContentRepository(sb) {
  return {
    async list({ type, status = "published", locale = "en" } = {}) {
      let query = sb.from("content_entries").select("*").eq("locale", locale);
      if (type) query = query.eq("type", type);
      if (status) query = query.eq("status", status);
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async get({ type, slug, locale = "en" } = {}) {
      const normalized = normalizeContentEntry({ type, slug, title: slug, locale });
      if (!normalized.type || !normalized.slug) return null;
      return existingEntry(sb, normalized);
    },

    async listRevisions({ type, slug, locale = "en" } = {}) {
      const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!entry?.id) return [];
      const { data, error } = await sb
        .from("content_revisions")
        .select("*")
        .eq("entry_id", entry.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async listAssets({ q = "", status = "available" } = {}) {
      let query = sb.from("content_assets").select("*");
      const assetStatus = String(status || "").trim();
      const search = String(q || "").trim();
      if (assetStatus && assetStatus !== "all") query = query.eq("status", assetStatus);
      if (search) query = query.ilike("storage_path", `%${search}%`);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },

    async saveAsset(input = {}, userId) {
      const storagePath = String(input.storage_path || "").trim();
      const alt = String(input.alt || "").trim();
      if (!storagePath) return { ok: false, error: "storage_path_required" };
      if (unsafeAssetReference(storagePath)) return { ok: false, error: "storage_path_invalid" };
      if (!alt) return { ok: false, error: "alt_required" };
      const status = input.status === "archived" ? "archived" : "available";
      const { data, error } = await sb
        .from("content_assets")
        .upsert({
          storage_path: storagePath,
          status,
          alt,
          mime_type: input.mime_type || null,
          width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
          height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
          focal_point: objectValue(input.focal_point),
          usage: Array.isArray(input.usage) ? input.usage : [],
          credit: input.credit || null,
          source_url: input.source_url || null,
          created_by: userId || null,
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "storage_path" })
        .select("*")
        .single();
      if (error) throw error;
      return { ok: true, asset: data };
    },

    async restoreRevision({ type, slug, locale = "en", version } = {}, userId) {
      const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!entry?.id) return { ok: false, error: "entry_not_found" };
      const revisionVersion = Number(version);
      if (!Number.isFinite(revisionVersion)) return { ok: false, error: "version_required" };
      const { data: revision, error } = await sb
        .from("content_revisions")
        .select("*")
        .eq("entry_id", entry.id)
        .eq("version", revisionVersion)
        .single();
      if (error) throw error;
      return this.saveEntry(
        {
          ...entry,
          payload: objectValue(revision.payload),
          seo: objectValue(revision.seo),
          status: "draft",
          published_at: null,
        },
        userId,
        `Restored revision ${revision.version}`,
      );
    },

    async transition(input = {}, userId, nextStatus, note, options = {}) {
      const normalized = normalizeContentEntry({
        ...input,
        title: input.title || input.slug,
        status: nextStatus,
      });
      const prior = await existingEntry(sb, normalized);
      if (!prior?.id) return { ok: false, error: "entry_not_found" };
      const conflict = contentLockConflict(prior, userId, options);
      if (conflict) return conflict;
      const patch = compactRow({
        status: nextStatus,
        scheduled_at: input.scheduled_at || null,
        review_note: note || null,
        updated_by: userId || null,
        updated_at: new Date().toISOString(),
      });
      const { data, error } = await sb
        .from("content_entries")
        .update(patch)
        .eq("id", prior.id)
        .select("*")
        .single();
      if (error) throw error;
      await writeRevision(sb, data, userId, note || `Status changed to ${nextStatus}`);
      return { ok: true, entry: data };
    },

    async saveDraft(input, userId, options = {}) {
      const validation = validateContentEntry({ ...input, status: "draft" });
      if (!validation.ok) return validation;
      return this.saveEntry(validation.entry, userId, "Draft saved", options);
    },

    async publish(input, userId, options = {}) {
      const validation = validateContentEntry({ ...input, status: "published" });
      if (!validation.ok) return validation;
      return this.saveEntry(
        {
          ...validation.entry,
          published_at: new Date().toISOString(),
          scheduled_at: null,
          review_note: null,
        },
        userId,
        "Published",
        options,
      );
    },

    async publishScheduledDue({ now = new Date().toISOString(), limit = 25, locale = "" } = {}, userId) {
      const timestamp = new Date(now);
      if (Number.isNaN(timestamp.getTime())) return { ok: false, error: "invalid_publish_time" };
      const batchLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
      let query = sb
        .from("content_entries")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_at", timestamp.toISOString());
      if (locale) query = query.eq("locale", locale);
      const { data, error } = await query
        .order("scheduled_at", { ascending: true })
        .limit(batchLimit);
      if (error) throw error;

      const entries = [];
      for (const entry of data || []) {
        const result = await this.publish(entry, userId, { force: true });
        if (!result.ok) return result;
        entries.push(result.entry);
      }
      return { ok: true, count: entries.length, entries };
    },

    async saveEntry(input, userId, note, options = {}) {
      const prior = await existingEntry(sb, input);
      const conflict = contentLockConflict(prior, userId, options);
      if (conflict) return conflict;
      const version = Number(prior?.version || 0) + 1;
      const now = new Date().toISOString();
      const row = compactRow({
        ...input,
        version,
        created_by: prior ? undefined : userId || null,
        updated_by: userId || null,
        updated_at: now,
      });
      const { data, error } = await sb
        .from("content_entries")
        .upsert(row, { onConflict: "type,slug,locale" })
        .select("*")
        .single();
      if (error) throw error;
      await writeRevision(sb, data, userId, note);
      return { ok: true, entry: data };
    },

    async lock({ type, slug, locale = "en" } = {}, userId, options = {}) {
      const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!entry?.id) return { ok: false, error: "entry_not_found" };
      const conflict = contentLockConflict(entry, userId, options);
      if (conflict) return conflict;
      const { data, error } = await sb
        .from("content_entries")
        .update({
          locked_by: userId || null,
          locked_at: new Date().toISOString(),
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id)
        .select("*")
        .single();
      if (error) throw error;
      return { ok: true, entry: data };
    },

    async unlock({ type, slug, locale = "en" } = {}, userId, options = {}) {
      const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!entry?.id) return { ok: false, error: "entry_not_found" };
      const conflict = contentLockConflict(entry, userId, options);
      if (conflict) return conflict;
      const { data, error } = await sb
        .from("content_entries")
        .update({
          locked_by: null,
          locked_at: null,
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id)
        .select("*")
        .single();
      if (error) throw error;
      return { ok: true, entry: data };
    },

    async archive({ type, slug, locale = "en" }, userId, options = {}) {
      const prior = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!prior?.id) return { ok: false, error: "entry_not_found" };
      const conflict = contentLockConflict(prior, userId, options);
      if (conflict) return conflict;
      const { data, error } = await sb
        .from("content_entries")
        .update({ status: "archived", updated_by: userId || null, updated_at: new Date().toISOString() })
        .eq("id", prior.id)
        .select("*")
        .single();
      if (error) throw error;
      await writeRevision(sb, data, userId, "Archived");
      return { ok: true, entry: data };
    },
  };
}

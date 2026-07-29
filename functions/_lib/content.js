import { CONTENT_TYPE_DEFINITIONS, validateStructuredPayload } from "../../js/content-types.js";
import { canonicalPublicImageUrl } from "../../js/image-url.js";
import { staffCan } from "./authz.js";

const CONTENT_IMAGE_KEYS = new Set(["hero", "image", "image_after", "og_image"]);

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

function canonicalizeImageFields(value) {
  return Object.fromEntries(Object.entries(objectValue(value)).map(([key, fieldValue]) => (
    CONTENT_IMAGE_KEYS.has(key)
      ? [key, canonicalPublicImageUrl(fieldValue)]
      : [key, fieldValue]
  )));
}

function compactRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

export function activeContentLock(entry = {}, nowMs = Date.now()) {
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
    payload: canonicalizeImageFields(input.payload),
    seo: canonicalizeImageFields(input.seo),
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

function githubDispatchConfig(env = {}) {
  const token = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  const repo = String(env.GITHUB_DISPATCH_REPO || "OJamals/masest").trim();
  return token && repo ? { token, repo } : null;
}

// Blog posts render to committed static pages by tools/build-blog.mjs, which the
// Cloudflare build does NOT run — so a CMS blog publish needs the GitHub Actions
// "content-published" workflow (publish-blog-ci -> build-blog -> commit) to fire.
// Best-effort: no-ops without a token; the scheduled run is the fallback.
export async function triggerBlogPublishWorkflow(env = {}, entry = {}, fetchImpl = fetch) {
  if (entry.type !== "blog_post") return { ok: true, skipped: true };
  const cfg = githubDispatchConfig(env);
  if (!cfg) return { ok: true, skipped: true };
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${cfg.repo}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "masest-cms",
      },
      body: JSON.stringify({
        event_type: "content-published",
        client_payload: { slug: entry.slug || "", status: entry.status || "published" },
      }),
    });
    if (response.ok || response.status === 204) return { ok: true, skipped: false, status: response.status };
    return { ok: false, skipped: false, status: response.status, error: "github_dispatch_failed" };
  } catch (error) {
    return { ok: false, skipped: false, error: "github_dispatch_failed", message: String(error?.message || error) };
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
      let query = sb.from("content_entries").select("*");
      if (locale) query = query.eq("locale", locale);
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
      const { data, error } = await query.order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data || [];
    },

    async getAsset(storagePath) {
      const path = String(storagePath || "").trim();
      if (!path) return null;
      const { data, error } = await sb.from("content_assets").select("*").eq("storage_path", path).maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async findAssetBySha256(sha256) {
      const hash = String(sha256 || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) return null;
      const { data, error } = await sb
        .from("content_assets")
        .select("*")
        .eq("sha256", hash)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async deleteAsset(storagePath) {
      const path = String(storagePath || "").trim();
      if (!path) return { ok: false, error: "storage_path_required" };
      const { error } = await sb.from("content_assets").delete().eq("storage_path", path);
      if (error) throw error;
      return { ok: true };
    },

    async saveAsset(input = {}, userId) {
      const storagePath = String(input.storage_path || "").trim();
      const alt = String(input.alt || "").trim();
      if (!storagePath) return { ok: false, error: "storage_path_required" };
      if (unsafeAssetReference(storagePath)) return { ok: false, error: "storage_path_invalid" };
      if (!alt) return { ok: false, error: "alt_required" };
      const status = input.status === "archived" ? "archived" : "available";
      // Preserve the original creator across updates. saveAsset is also the archive/restore
      // path (it re-sends the whole row), so blindly writing created_by would overwrite the
      // first editor's provenance with whoever last touched the asset.
      const { data: existing } = await sb
        .from("content_assets").select("created_by").eq("storage_path", storagePath).maybeSingle();
      const { data, error } = await sb
        .from("content_assets")
        .upsert({
          storage_path: storagePath,
          status,
          alt,
          mime_type: input.mime_type || null,
          byte_size: Number.isFinite(Number(input.byte_size)) ? Number(input.byte_size) : null,
          sha256: /^[a-f0-9]{64}$/i.test(String(input.sha256 || ""))
            ? String(input.sha256).toLowerCase()
            : null,
          width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
          height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
          focal_point: objectValue(input.focal_point),
          usage: Array.isArray(input.usage) ? input.usage : [],
          credit: input.credit || null,
          source_url: input.source_url || null,
          created_by: existing?.created_by || userId || null,
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
        version: Number(prior.version || 0) + 1,
        scheduled_at: input.scheduled_at || null,
        review_note: note || null,
        updated_by: userId || null,
        updated_at: new Date().toISOString(),
        // Persist the editor's in-progress field edits alongside the status change.
        // The workflow buttons (Submit for review / Schedule publish / Request changes)
        // send the full open-form entry; without this the transition wrote only status
        // and silently dropped any unsaved payload/title/seo edits — a reviewer could then
        // publish stale content. Guarded on `!== undefined` so a minimal transition call
        // (identity only) never wipes existing content.
        payload: input.payload !== undefined ? normalized.payload : undefined,
        title: input.title !== undefined && normalized.title ? normalized.title : undefined,
        seo: input.seo !== undefined ? normalized.seo : undefined,
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

    async publishScheduledDue({ now = new Date().toISOString(), limit = 25, locale = "", type = "" } = {}, userId) {
      const timestamp = new Date(now);
      if (Number.isNaN(timestamp.getTime())) return { ok: false, error: "invalid_publish_time" };
      const batchLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
      let query = sb
        .from("content_entries")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_at", timestamp.toISOString());
      if (locale) query = query.eq("locale", locale);
      if (type) query = query.eq("type", type);
      const { data, error } = await query
        .order("scheduled_at", { ascending: true })
        .limit(batchLimit);
      if (error) throw error;

      // Publish each due entry independently. A single entry whose payload no longer passes
      // validation (e.g. its content-type gained a required field after it was scheduled) must
      // not abort the whole run — collect failures and keep publishing the rest.
      const entries = [];
      const skipped = [];
      for (const entry of data || []) {
        const result = await this.publish(entry, userId, { force: true });
        if (!result.ok) {
          skipped.push({ type: entry.type, slug: entry.slug, error: result.error });
          continue;
        }
        entries.push(result.entry);
      }
      return { ok: true, count: entries.length, entries, skipped };
    },

    async saveEntry(input, userId, note, options = {}) {
      const prior = await existingEntry(sb, input);
      const conflict = contentLockConflict(prior, userId, options);
      if (conflict) return conflict;
      const expectedVersion = Number(options.expectedVersion);
      const checksVersion = Number.isFinite(expectedVersion);
      if (checksVersion && Number(prior?.version || 0) !== expectedVersion) {
        return {
          ok: false,
          error: "content_version_conflict",
          expected_version: expectedVersion,
          current_version: Number(prior?.version || 0),
        };
      }
      const version = Number(prior?.version || 0) + 1;
      const now = new Date().toISOString();
      const row = compactRow({
        ...input,
        version,
        created_by: prior ? undefined : userId || null,
        updated_by: userId || null,
        updated_at: now,
      });
      let result;
      if (prior && checksVersion) {
        result = await sb.from("content_entries")
          .update(row)
          .eq("id", prior.id)
          .eq("version", expectedVersion)
          .select("*")
          .maybeSingle();
        if (!result.error && !result.data) {
          const current = await existingEntry(sb, input);
          return {
            ok: false,
            error: "content_version_conflict",
            expected_version: expectedVersion,
            current_version: Number(current?.version || 0),
          };
        }
      } else {
        result = await sb.from("content_entries")
          .upsert(row, { onConflict: "type,slug,locale" })
          .select("*")
          .single();
      }
      const { data, error } = result;
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
        .update({
          status: "archived",
          version: Number(prior.version || 0) + 1,
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", prior.id)
        .select("*")
        .single();
      if (error) throw error;
      await writeRevision(sb, data, userId, "Archived");
      return { ok: true, entry: data };
    },

    async unarchive({ type, slug, locale = "en" }, userId, options = {}) {
      const prior = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
      if (!prior?.id) return { ok: false, error: "entry_not_found" };
      const conflict = contentLockConflict(prior, userId, options);
      if (conflict) return conflict;
      const { data, error } = await sb
        .from("content_entries")
        .update({
          status: "draft",
          version: Number(prior.version || 0) + 1,
          scheduled_at: null,
          published_at: null,
          review_note: null,
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", prior.id)
        .select("*")
        .single();
      if (error) throw error;
      await writeRevision(sb, data, userId, "Restored from archive");
      return { ok: true, entry: data };
    },
  };
}

const CONTENT_ACTION_POLICY = Object.freeze({
  publish_scheduled: {
    capability: "content.publish",
    message: "Publishing scheduled content requires owner access.",
  },
  lock: {
    capability: "content.write",
    message: "Locking content requires owner access.",
  },
  unlock: {
    capability: "content.write",
    message: "Unlocking content requires owner access.",
  },
  force_unlock: {
    capability: "content.review",
    message: "Force unlocking content requires reviewer access.",
  },
  unarchive: {
    capability: "content.write",
    message: "Restoring archived content requires owner access.",
  },
  submit_review: {
    capability: "content.write",
    message: "Submitting content requires owner access.",
  },
  request_changes: {
    capability: "content.review",
    message: "Requesting changes requires owner access.",
  },
  schedule: {
    capability: "content.publish",
    message: "Scheduling content requires owner access.",
  },
  publish: {
    capability: "content.publish",
    message: "Publishing content requires owner access.",
  },
  save_draft: {
    capability: "content.write",
    message: "Editing content requires owner access.",
  },
  archive: {
    capability: "content.write",
    message: "Archiving content requires owner access.",
  },
});

function publicationResponse(result) {
  if (result.ok) return { status: 200, result };
  return {
    status: result.error === "content_locked" ? 409 : 400,
    result,
  };
}

function denied(action) {
  const policy = CONTENT_ACTION_POLICY[action] || CONTENT_ACTION_POLICY.save_draft;
  return {
    status: 403,
    result: { error: "forbidden", message: policy.message },
  };
}

export function createContentPublicationLifecycle({
  repository,
  publishHook = async () => ({ ok: false, skipped: "publish_hook_not_configured" }),
  blogWorkflow = async () => ({ ok: false, skipped: "blog_workflow_not_configured" }),
} = {}) {
  if (!repository) throw new Error("content_repository_required");

  async function publishScheduled({
    type = "",
    userId,
    role,
    system = false,
  } = {}) {
    if (!system && !staffCan(role, "content.publish")) {
      return denied("publish_scheduled");
    }
    try {
      const result = await repository.publishScheduledDue(type ? { type } : {}, userId);
      if (result.ok && result.count > 0) {
        result.publish_hook = await publishHook(result.entries[0]);
        const blogEntry = result.entries.find((entry) => entry?.type === "blog_post");
        if (blogEntry) result.blog_workflow = await blogWorkflow(blogEntry);
      }
      return publicationResponse(result);
    } catch (error) {
      return { status: 500, result: { error: error.message } };
    }
  }

  async function execute({
    action: requestedAction,
    entry = {},
    body = {},
    userId,
    role,
  } = {}) {
    const action = requestedAction || "save_draft";
    const policy = CONTENT_ACTION_POLICY[action] || CONTENT_ACTION_POLICY.save_draft;
    if (!staffCan(role, policy.capability)) return denied(action);

    try {
      if (action === "publish_scheduled") {
        return publishScheduled({
          type: body.type || "",
          userId,
          role,
        });
      }

      let result;
      if (action === "lock") {
        result = await repository.lock(entry, userId);
      } else if (action === "unlock") {
        result = await repository.unlock(entry, userId);
      } else if (action === "force_unlock") {
        result = await repository.unlock(entry, userId, { force: true });
      } else if (action === "unarchive") {
        result = await repository.unarchive(entry, userId);
      } else if (action === "submit_review") {
        result = await repository.transition(
          entry,
          userId,
          "in_review",
          body.note || "Submitted for review",
        );
      } else if (action === "request_changes") {
        result = await repository.transition(
          entry,
          userId,
          "changes_requested",
          body.note || "Changes requested",
        );
      } else if (action === "schedule") {
        const scheduledAt = new Date(entry.scheduled_at || "");
        if (!entry.scheduled_at || Number.isNaN(scheduledAt.getTime())) {
          return {
            status: 400,
            result: {
              error: "scheduled_at_required",
              message: "Choose a publish date before scheduling.",
            },
          };
        }
        entry.scheduled_at = scheduledAt.toISOString();
        result = await repository.transition(
          entry,
          userId,
          "scheduled",
          body.note || "Scheduled publish",
        );
      } else if (action === "publish") {
        result = await repository.publish(entry, userId);
        if (result.ok) {
          result.publish_hook = await publishHook(result.entry);
          result.blog_workflow = await blogWorkflow(result.entry);
        }
      } else {
        result = await repository.saveDraft(entry, userId);
      }
      return publicationResponse(result);
    } catch (error) {
      return { status: 500, result: { error: error.message } };
    }
  }

  async function archive({ entry = {}, userId, role } = {}) {
    if (!staffCan(role, "content.write")) return denied("archive");
    try {
      const result = await repository.archive(entry, userId);
      if (result.ok) result.publish_hook = await publishHook(result.entry);
      return publicationResponse(result);
    } catch (error) {
      return { status: 500, result: { error: error.message } };
    }
  }

  return { execute, publishScheduled, archive };
}

// /api/admin/content-assets - metadata library for CMS-owned public content assets.
import { adminClient, requireStaff, json, readBody } from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { recordAudit } from "../../_lib/audit.js";
import { activeContentLock, createContentRepository } from "../../_lib/content.js";
import { canonicalPublicImageUrl } from "../../../js/image-url.js";

const DEFAULT_CONTENT_ASSET_BUCKET = "content-assets";
const DEFAULT_MAX_CONTENT_ASSET_BYTES = 6 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/avif", "avif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["avif", "jpeg", "jpg", "png", "webp"]);

function contentAssetBucket(env = {}) {
  return String(env.CONTENT_ASSET_BUCKET || DEFAULT_CONTENT_ASSET_BUCKET).trim() || DEFAULT_CONTENT_ASSET_BUCKET;
}

function contentAssetMaxBytes(env = {}) {
  const configured = Number(env.CONTENT_ASSET_MAX_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_CONTENT_ASSET_BYTES;
  return Math.min(configured, 25 * 1024 * 1024);
}

function encodeStoragePath(path) {
  return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function contentAssetPublicUrl(env, storagePath) {
  const path = String(storagePath || "").trim();
  if (!path) return "";
  const publicPath = canonicalPublicImageUrl(path);
  if (/^(https?:)?\/\//i.test(publicPath) || publicPath.startsWith("/")) {
    return publicPath;
  }
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return path;
  return `${base}/storage/v1/object/public/${contentAssetBucket(env)}/${encodeStoragePath(path)}`;
}

export function assetPublicUrl(env, asset) {
  const sourceUrl = canonicalPublicImageUrl(asset?.source_url);
  return sourceUrl || contentAssetPublicUrl(env, asset?.storage_path);
}

export function siteStoragePath(storagePath) {
  const logical = canonicalPublicImageUrl(storagePath).split(/[?#]/, 1)[0];
  return /^\/img\/[a-z0-9_./%()+@-]+$/i.test(logical) && !logical.includes("..")
    ? `site${logical}`
    : "";
}

export function managedStoragePath(env, asset) {
  const sourceUrl = String(asset?.source_url || "").trim();
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const prefix = `${base}/storage/v1/object/public/${contentAssetBucket(env)}/`;
  if (base && sourceUrl.startsWith(prefix)) {
    try {
      const path = sourceUrl.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
      if (path && !path.split("/").some((part) => !part || part === "." || part === "..")) return path;
    } catch {
      return "";
    }
  }
  const storagePath = String(asset?.storage_path || "").trim();
  return storagePath && !storagePath.startsWith("/") && assetPublicUrl(env, asset) === contentAssetPublicUrl(env, storagePath)
    ? storagePath
    : "";
}

function withPublicUrl(env, asset) {
  if (!asset) return asset;
  return { ...asset, public_url: assetPublicUrl(env, asset) };
}

function referenceKey(value) {
  const canonical = canonicalPublicImageUrl(value).split(/[?#]/, 1)[0];
  if (!canonical) return "";
  try {
    const url = new URL(canonical, "https://masest.co");
    if (/^(?:www\.)?masest\.co$/i.test(url.hostname) && /^\/img\//i.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    return canonical;
  }
  return canonical;
}

function collectReferences(value, path, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, `${path}[${index}]`, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectReferences(item, path ? `${path}.${key}` : key, found);
    });
  } else if (typeof value === "string") {
    found.push({ value, path });
  }
}

export function withContentAssetReferences(assets = [], entries = []) {
  const aliases = new Map();
  const references = new Map();
  assets.forEach((asset, index) => {
    references.set(index, new Map());
    [asset.storage_path, asset.public_url, asset.source_url].forEach((value) => {
      const key = referenceKey(value);
      if (key) {
        const matches = aliases.get(key) || new Set();
        matches.add(index);
        aliases.set(key, matches);
      }
    });
  });

  entries.forEach((entry) => {
    const found = [];
    collectReferences(entry.payload, "payload", found);
    collectReferences(entry.seo, "seo", found);
    found.forEach(({ value, path }) => {
      const keys = new Set();
      const exact = referenceKey(value);
      if (aliases.has(exact)) keys.add(exact);
      if (String(value).includes("/")) {
        aliases.forEach((_matches, key) => {
          if (containsAssetReference(value, key)) keys.add(key);
        });
      }
      keys.forEach((key) => aliases.get(key).forEach((assetIndex) => {
        const entryKey = `${entry.type}:${entry.slug}:${entry.locale || "en"}`;
        const impacted = references.get(assetIndex);
        const reference = impacted.get(entryKey) || {
          type: entry.type,
          slug: entry.slug,
          locale: entry.locale || "en",
          status: entry.status,
          title: entry.title,
          fields: [],
        };
        if (!reference.fields.includes(path)) reference.fields.push(path);
        impacted.set(entryKey, reference);
      }));
    });
  });

  return assets.map((asset, index) => {
    const impacted = [...references.get(index).values()];
    return { ...asset, reference_count: impacted.length, references: impacted };
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assetReferencePattern(source) {
  const boundary = "[^A-Za-z0-9._~%+@/:-]";
  return new RegExp(`(^|${boundary})${escapeRegExp(source)}(?=$|${boundary})`, "g");
}

function containsAssetReference(value, source) {
  return assetReferencePattern(source).test(String(value));
}

function replacementPairs(source = {}, target = {}) {
  const targetUrl = String(target.public_url || target.source_url || target.storage_path || "").trim();
  const pairs = new Map();
  [source.public_url, source.source_url, source.storage_path].forEach((value) => {
    const alias = String(value || "").trim();
    if (alias && targetUrl && alias !== targetUrl) pairs.set(alias, targetUrl);
  });
  return [...pairs.entries()].sort(([left], [right]) => right.length - left.length);
}

function replaceAssetReference(value, pairs) {
  return pairs.reduce((current, [source, target]) => {
    return current.replace(assetReferencePattern(source), (_match, prefix) => `${prefix}${target}`);
  }, String(value));
}

function replaceAssetReferences(value, path, pairs, fields) {
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceAssetReferences(item, `${path}[${index}]`, pairs, fields));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      replaceAssetReferences(item, path ? `${path}.${key}` : key, pairs, fields),
    ]));
  }
  if (typeof value !== "string") return value;
  const after = replaceAssetReference(value, pairs);
  if (after !== value) fields.push({ path, before: value, after });
  return after;
}

export function planContentAssetReplacement({ source = {}, target = {}, entries = [] } = {}) {
  const pairs = replacementPairs(source, target);
  const changes = [];
  entries.forEach((entry) => {
    const fields = [];
    const payload = replaceAssetReferences(entry.payload, "payload", pairs, fields);
    const seo = replaceAssetReferences(entry.seo, "seo", pairs, fields);
    if (!fields.length) return;
    changes.push({
      id: entry.id,
      type: entry.type,
      slug: entry.slug,
      locale: entry.locale || "en",
      title: entry.title,
      status: entry.status,
      version: Number(entry.version || 0),
      fields,
      current: entry,
      next: { ...entry, payload, seo },
    });
  });
  return { source, target, changes };
}

function publicReplacementPreview(plan, impactHash) {
  const changes = plan.changes.map(({ current: _current, next: _next, ...change }) => change);
  return {
    source: plan.source,
    target: plan.target,
    change_count: changes.length,
    field_count: changes.reduce((total, change) => total + change.fields.length, 0),
    changes,
    impact_hash: impactHash,
    rollback: "Each changed content entry keeps its prior version. Roll back from Revisions.",
  };
}

function isMultipart(request) {
  return (request.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
}

function cleanFilePart(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseUsage(form) {
  return [
    ...String(form.get("usage") || "").split(","),
    ...form.getAll("usage[]"),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function tinifyAuthorization(apiKey) {
  return `Basic ${btoa(`api:${apiKey}`)}`;
}

async function sha256Hex(body) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function replacementImpactHash(plan) {
  const material = {
    source: plan.source.storage_path,
    target: plan.target.storage_path,
    changes: plan.changes.map((change) => ({
      id: change.id,
      type: change.type,
      slug: change.slug,
      locale: change.locale,
      version: change.version,
      fields: change.fields,
    })),
  };
  return sha256Hex(new TextEncoder().encode(JSON.stringify(material)));
}

async function optimizeWithTinyPng(file, env) {
  const apiKey = String(env.TINIFY_API_KEY || "").trim();
  if (!apiKey) return { ok: false, status: 503, error: "optimized_image_required" };
  const authorization = tinifyAuthorization(apiKey);
  try {
    const source = await fetch("https://api.tinify.com/shrink", {
      method: "POST",
      headers: { Authorization: authorization, "content-type": String(file.type || "") },
      body: await file.arrayBuffer(),
    });
    if (!source.ok) return { ok: false, status: source.status === 429 ? 429 : 502, error: "image_optimization_failed" };
    const resultUrl = source.headers.get("location");
    if (!resultUrl) return { ok: false, status: 502, error: "image_optimization_failed" };
    const optimized = await fetch(resultUrl, { headers: { Authorization: authorization } });
    if (!optimized.ok) return { ok: false, status: 502, error: "image_optimization_failed" };
    const body = await optimized.arrayBuffer();
    if (!body.byteLength) return { ok: false, status: 502, error: "image_optimization_failed" };
    return { ok: true, body, bytesSaved: Math.max(0, Number(file.size || 0) - body.byteLength) };
  } catch {
    return { ok: false, status: 502, error: "image_optimization_failed" };
  }
}

function isManagedAsset(env, asset) {
  return Boolean(managedStoragePath(env, asset));
}

async function deleteStoredAsset(env, storagePath) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "storage_not_configured" };
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${contentAssetBucket(env)}/${encodeStoragePath(storagePath)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  return response.ok || response.status === 404 ? { ok: true } : { ok: false, error: "storage_delete_failed" };
}

async function saveUploadedAsset({ request, env, repo, userId }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return { status: 400, body: { error: "expected_multipart" } };
  }

  const file = form.get("file");
  if (!file || typeof file === "string") return { status: 400, body: { error: "file_required" } };

  const type = String(file.type || "");
  if (!ALLOWED_IMAGE_TYPES.has(type)) return { status: 400, body: { error: "unsupported_image_type" } };

  const size = Number(file.size || 0);
  if (size <= 0) return { status: 400, body: { error: "file_empty" } };
  if (size > contentAssetMaxBytes(env)) return { status: 413, body: { error: "asset_too_large" } };

  const alt = String(form.get("alt") || "").trim();
  if (!alt) return { status: 400, body: { error: "alt_required" } };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 500, body: { error: "storage_not_configured" } };
  }
  const optimized = await optimizeWithTinyPng(file, env);
  if (!optimized.ok) return { status: optimized.status, body: { error: optimized.error } };
  const sha256 = await sha256Hex(optimized.body);
  const duplicate = await repo.findAssetBySha256(sha256);
  if (duplicate) {
    return {
      status: 200,
      body: {
        ok: true,
        asset: { ...withPublicUrl(env, duplicate), alt },
        deduplicated: true,
        original_bytes: size,
        stored_bytes: 0,
        optimized_bytes_saved: optimized.bytesSaved,
        duplicate_bytes_avoided: optimized.body.byteLength,
      },
    };
  }

  const fileName = String(file.name || "asset");
  const rawExt = cleanFilePart(fileName.split(".").pop(), ALLOWED_IMAGE_TYPES.get(type));
  const ext = ALLOWED_IMAGE_EXTENSIONS.has(rawExt)
    ? (rawExt === "jpeg" ? "jpg" : rawExt)
    : ALLOWED_IMAGE_TYPES.get(type);
  const stem = cleanFilePart(fileName.replace(/\.[^.]+$/, ""), "asset");
  const folder = cleanFilePart(form.get("folder"), "cms");
  const storagePath = `${folder}/${crypto.randomUUID()}-${stem}.${ext}`;
  const bucket = contentAssetBucket(env);

  const upload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": type,
      "x-upsert": "false",
    },
    body: optimized.body,
  });
  if (!upload.ok) {
    return {
      status: 502,
      body: { error: "upload_failed", detail: await upload.text().catch(() => "") },
    };
  }

  const publicUrl = contentAssetPublicUrl(env, storagePath);
  const result = await repo.saveAsset({
    storage_path: storagePath,
    alt,
    mime_type: type,
    byte_size: optimized.body.byteLength,
    sha256: sha256,
    width: Number(form.get("width")) || null,
    height: Number(form.get("height")) || null,
    usage: parseUsage(form),
    source_url: publicUrl,
  }, userId);
  if (!result.ok) {
    await deleteStoredAsset(env, storagePath);
    return { status: 400, body: { error: result.error } };
  }
  return {
    status: 200,
    body: {
      ...result,
      asset: withPublicUrl(env, result.asset),
      deduplicated: false,
      original_bytes: size,
      stored_bytes: optimized.body.byteLength,
      optimized_bytes_saved: optimized.bytesSaved,
    },
  };
}

async function contentAssetReplacementPlan({ body, env, repo }) {
  const sourcePath = String(body?.source_storage_path || "").trim();
  const targetPath = String(body?.target_storage_path || "").trim();
  if (!sourcePath || !targetPath) {
    return { status: 400, body: { error: "source_and_target_required" } };
  }
  if (sourcePath === targetPath) {
    return { status: 409, body: { error: "replacement_asset_must_differ" } };
  }
  const [sourceRow, targetRow, entries] = await Promise.all([
    repo.getAsset(sourcePath),
    repo.getAsset(targetPath),
    repo.list({ status: "", locale: "" }),
  ]);
  if (!sourceRow || !targetRow) return { status: 404, body: { error: "asset_not_found" } };
  if (sourceRow.status !== "available" || targetRow.status !== "available") {
    return { status: 409, body: { error: "replacement_asset_unavailable" } };
  }
  const plan = planContentAssetReplacement({
    source: withPublicUrl(env, sourceRow),
    target: withPublicUrl(env, targetRow),
    entries,
  });
  const impactHash = await replacementImpactHash(plan);
  return { status: 200, plan, preview: publicReplacementPreview(plan, impactHash) };
}

async function previewContentAssetReplacement(context) {
  const result = await contentAssetReplacementPlan(context);
  if (result.status !== 200) return result;
  return { status: 200, body: { ok: true, preview: result.preview } };
}

async function applyContentAssetReplacement({ body, env, repo, user, sb }) {
  if (body?.confirm !== "replace_everywhere") {
    return { status: 409, body: { error: "replace_everywhere_confirmation_required" } };
  }
  const result = await contentAssetReplacementPlan({ body, env, repo });
  if (result.status !== 200) return result;
  if (!body.impact_hash || body.impact_hash !== result.preview.impact_hash) {
    return {
      status: 409,
      body: {
        error: "asset_impact_changed",
        message: "Content references changed. Review the updated diff before applying.",
        preview: result.preview,
      },
    };
  }

  const locked = result.plan.changes.find((change) => {
    return activeContentLock(change.current)
      && String(change.current.locked_by) !== String(user.id);
  });
  if (locked) {
    return {
      status: 409,
      body: {
        error: "content_locked",
        message: `${locked.title || locked.slug} is being edited. Retry after its lock is released.`,
        entry: {
          type: locked.type,
          slug: locked.slug,
          locale: locked.locale,
          locked_by: locked.current.locked_by,
          locked_at: locked.current.locked_at,
        },
      },
    };
  }

  const applied = [];
  let failureCode = "";
  try {
    for (const change of result.plan.changes) {
      const saved = await repo.saveEntry(
        change.next,
        user.id,
        `Media replaced: ${result.plan.source.storage_path} → ${result.plan.target.storage_path}`,
        { expectedVersion: change.version },
      );
      if (!saved.ok) {
        failureCode = saved.error || "content_save_failed";
        throw new Error(failureCode);
      }
      applied.push({ change, entry: saved.entry });
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const item of [...applied].reverse()) {
      try {
        const restored = await repo.saveEntry(
          item.change.current,
          user.id,
          `Automatic rollback after failed media replacement`,
          { force: true },
        );
        if (!restored.ok) rollbackFailures.push(item.change.id || item.change.slug);
      } catch {
        rollbackFailures.push(item.change.id || item.change.slug);
      }
    }
    if (failureCode === "content_version_conflict" && !rollbackFailures.length) {
      const refreshed = await contentAssetReplacementPlan({ body, env, repo });
      return {
        status: 409,
        body: {
          error: "asset_impact_changed",
          message: "Content changed during replacement. Review the updated diff before applying again.",
          preview: refreshed.status === 200 ? refreshed.preview : undefined,
          rolled_back: applied.length,
          rollback_failures: [],
        },
      };
    }
    return {
      status: 500,
      body: {
        error: "replace_everywhere_failed",
        message: error.message,
        rolled_back: applied.length - rollbackFailures.length,
        rollback_failures: rollbackFailures,
      },
    };
  }

  await recordAudit(sb, {
    user,
    action: "content_asset.references_replaced",
    targetType: "content_asset",
    targetId: result.plan.source.storage_path,
    detail: {
      source_storage_path: result.plan.source.storage_path,
      target_storage_path: result.plan.target.storage_path,
      impact_hash: result.preview.impact_hash,
      replaced_entries: applied.length,
      replaced_fields: result.preview.field_count,
      revisions: applied.map(({ change, entry }) => ({
        type: change.type,
        slug: change.slug,
        locale: change.locale,
        previous_version: change.version,
        current_version: entry.version,
      })),
    },
  });
  return {
    status: 200,
    body: {
      ok: true,
      target: result.preview.target,
      replaced_entries: applied.length,
      replaced_fields: result.preview.field_count,
      rollback: applied.map(({ change, entry }) => ({
        type: change.type,
        slug: change.slug,
        locale: change.locale,
        version: change.version,
        current_version: entry.version,
      })),
    },
  };
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const sb = adminClient(env);
  const repo = createContentRepository(sb);
  if (request.method !== "GET" && !staffCan(role, "content.assets")) {
    return json(403, { error: "forbidden", message: "Managing content assets requires owner access." });
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    try {
      const [assets, entries] = await Promise.all([
        repo.listAssets({
          q: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") === "all" ? "" : url.searchParams.get("status") || "available",
        }),
        repo.list({ status: "", locale: "" }),
      ]);
      return json(200, {
        assets: withContentAssetReferences(
          assets.map((asset) => withPublicUrl(env, asset)),
          entries,
        ),
      });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "POST") {
    try {
      if (isMultipart(request)) {
        const result = await saveUploadedAsset({ request, env, repo, userId: user.id });
        return json(result.status, result.body);
      }
      const body = await readBody(request);
      if (body?.action === "preview_replace_everywhere") {
        const result = await previewContentAssetReplacement({ body, env, repo });
        return json(result.status, result.body);
      }
      if (body?.action === "apply_replace_everywhere") {
        const result = await applyContentAssetReplacement({ body, env, repo, user, sb });
        return json(result.status, result.body);
      }
      const result = await repo.saveAsset(body || {}, user.id);
      if (!result.ok) return json(400, { error: result.error });
      return json(200, { ...result, asset: withPublicUrl(env, result.asset) });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "PUT") {
    return json(409, {
      error: "in_place_replace_unsafe",
      message: "Upload a new asset and use previewed replace everywhere.",
    });
  }

  if (request.method === "DELETE") {
    try {
      const url = new URL(request.url);
      if (url.searchParams.get("permanent") !== "true") {
        return json(409, { error: "permanent_delete_confirmation_required" });
      }
      const storagePath = url.searchParams.get("storage_path") || "";
      const asset = await repo.getAsset(storagePath);
      if (!asset) return json(404, { error: "asset_not_found" });
      if (asset.status !== "archived") return json(409, { error: "asset_must_be_archived" });
      const managed = isManagedAsset(env, asset);
      if (managed) {
        const deleted = await deleteStoredAsset(env, managedStoragePath(env, asset));
        if (!deleted.ok) return json(502, { error: deleted.error });
      }
      const result = await repo.deleteAsset(asset.storage_path);
      if (!result.ok) return json(400, { error: result.error });
      await recordAudit(sb, {
        user,
        action: "content_asset.deleted",
        targetType: "content_asset",
        targetId: asset.storage_path,
        detail: { managed, byte_size: asset.byte_size || null },
      });
      return json(200, { ok: true });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  return json(405, { error: "method_not_allowed" });
}

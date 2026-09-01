// /api/admin/content-assets - metadata library for CMS-owned public content assets.
import {
  adminClient,
  internalServerError,
  json,
  readBody,
  reportInternalError,
  requireStaff,
} from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { recordAudit } from "../../_lib/audit.js";
import { createContentRepository } from "../../_lib/content.js";
import {
  createContentAssetReplacementService,
  withContentAssetReferences,
} from "../../_lib/content-asset-replacement.js";
import {
  CONTENT_ASSET_PUBLIC_BASE,
  canonicalContentAssetUrl,
  canonicalPublicImageUrl,
  contentAssetPublicUrl as publicContentAssetUrl,
  managedContentAssetPath,
} from "../../../js/image-url.js";

const DEFAULT_MAX_CONTENT_ASSET_BYTES = 6 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/avif", "avif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["avif", "jpeg", "jpg", "png", "webp"]);

function contentAssetMaxBytes(env = {}) {
  const configured = Number(env.CONTENT_ASSET_MAX_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_CONTENT_ASSET_BYTES;
  return Math.min(configured, 25 * 1024 * 1024);
}

function contentAssetPublicBase(env = {}) {
  return String(env.CONTENT_ASSET_PUBLIC_BASE || CONTENT_ASSET_PUBLIC_BASE).trim().replace(/\/+$/, "")
    || CONTENT_ASSET_PUBLIC_BASE;
}

function managedAssetSourcePath(env, sourceUrl) {
  const managedPath = managedContentAssetPath(sourceUrl, contentAssetPublicBase(env));
  if (!managedPath) return "";
  try {
    const source = new URL(sourceUrl);
    if (!source.hostname.endsWith(".supabase.co")) return managedPath;
    const configured = new URL(String(env.SUPABASE_URL || ""));
    return source.origin === configured.origin ? managedPath : "";
  } catch {
    return "";
  }
}

function contentAssetPublicUrl(env, storagePath) {
  const value = canonicalPublicImageUrl(storagePath);
  if (!value) return "";
  if (/^\/img\//i.test(value)) return canonicalContentAssetUrl(value, contentAssetPublicBase(env));
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith("/")) return value;
  return publicContentAssetUrl(value, contentAssetPublicBase(env));
}

export function assetPublicUrl(env, asset) {
  const sourceUrl = canonicalPublicImageUrl(asset?.source_url);
  if (managedAssetSourcePath(env, sourceUrl) || /^\/img\//i.test(sourceUrl)) {
    return canonicalContentAssetUrl(sourceUrl, contentAssetPublicBase(env));
  }
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
  const managedPath = managedAssetSourcePath(env, sourceUrl);
  if (managedPath) return managedPath;
  const logicalPath = siteStoragePath(sourceUrl);
  if (logicalPath) return logicalPath;
  if (sourceUrl) return "";
  const storagePath = String(asset?.storage_path || "").trim();
  return storagePath && !storagePath.startsWith("/") && assetPublicUrl(env, asset) === contentAssetPublicUrl(env, storagePath)
    ? storagePath
    : "";
}

function withPublicUrl(env, asset) {
  if (!asset) return asset;
  return { ...asset, public_url: assetPublicUrl(env, asset) };
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
  if (!env.CONTENT_IMAGES || typeof env.CONTENT_IMAGES.delete !== "function") {
    return { ok: false, error: "storage_not_configured" };
  }
  try {
    await env.CONTENT_IMAGES.delete(storagePath);
    return { ok: true };
  } catch (error) {
    reportInternalError("admin.content_assets.delete_storage", error);
    return { ok: false, error: "storage_delete_failed" };
  }
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
  if (!env.CONTENT_IMAGES || typeof env.CONTENT_IMAGES.put !== "function") {
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

  try {
    await env.CONTENT_IMAGES.put(storagePath, optimized.body, {
      httpMetadata: {
        contentType: type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { sha256 },
    });
  } catch (error) {
    reportInternalError("admin.content_assets.upload", error);
    return {
      status: 502,
      body: { error: "upload_failed" },
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

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const sb = adminClient(env);
  const repo = createContentRepository(sb);
  const replacement = createContentAssetReplacementService({
    repository: repo,
    publicAsset: (asset) => withPublicUrl(env, asset),
    audit: (event) => recordAudit(sb, event),
  });
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
      return internalServerError("admin.content_assets.list", error);
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
        const result = await replacement.preview({
          sourceStoragePath: body.source_storage_path,
          targetStoragePath: body.target_storage_path,
        });
        return json(result.status, result.body);
      }
      if (body?.action === "apply_replace_everywhere") {
        const result = await replacement.apply({
          sourceStoragePath: body.source_storage_path,
          targetStoragePath: body.target_storage_path,
          impactHash: body.impact_hash,
          confirm: body.confirm,
          user,
        });
        return json(result.status, result.body);
      }
      const result = await repo.saveAsset(body || {}, user.id);
      if (!result.ok) return json(400, { error: result.error });
      return json(200, { ...result, asset: withPublicUrl(env, result.asset) });
    } catch (error) {
      return internalServerError("admin.content_assets.save", error);
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
      return internalServerError("admin.content_assets.delete", error);
    }
  }

  return json(405, { error: "method_not_allowed" });
}

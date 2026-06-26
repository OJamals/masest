// /api/admin/content-assets - metadata library for CMS-owned public content assets.
import { adminClient, requireStaff, json, readBody } from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { createContentRepository } from "../../_lib/content.js";

const DEFAULT_CONTENT_ASSET_BUCKET = "content-assets";

function contentAssetBucket(env = {}) {
  return String(env.CONTENT_ASSET_BUCKET || DEFAULT_CONTENT_ASSET_BUCKET).trim() || DEFAULT_CONTENT_ASSET_BUCKET;
}

function encodeStoragePath(path) {
  return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function contentAssetPublicUrl(env, storagePath) {
  const path = String(storagePath || "").trim();
  if (!path) return "";
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("/") || path.startsWith("img/") || path.startsWith("data:")) {
    return path;
  }
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return path;
  return `${base}/storage/v1/object/public/${contentAssetBucket(env)}/${encodeStoragePath(path)}`;
}

function withPublicUrl(env, asset) {
  if (!asset) return asset;
  return { ...asset, public_url: contentAssetPublicUrl(env, asset.storage_path) };
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
  if (!type.startsWith("image/")) return { status: 400, body: { error: "not_an_image" } };

  const alt = String(form.get("alt") || "").trim();
  if (!alt) return { status: 400, body: { error: "alt_required" } };

  const fileName = String(file.name || "asset");
  const ext = cleanFilePart(fileName.split(".").pop(), "webp") || "webp";
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
    body: await file.arrayBuffer(),
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
    usage: parseUsage(form),
    source_url: publicUrl,
  }, userId);
  if (!result.ok) return { status: 400, body: { error: result.error } };
  return { status: 200, body: { ...result, asset: withPublicUrl(env, result.asset) } };
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const repo = createContentRepository(adminClient(env));

  if (request.method === "GET") {
    const url = new URL(request.url);
    try {
      const assets = await repo.listAssets({
        q: url.searchParams.get("q") || "",
        status: url.searchParams.get("status") || "available",
      });
      return json(200, { assets: assets.map((asset) => withPublicUrl(env, asset)) });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "POST") {
    if (!staffCan(role, "content.assets")) {
      return json(403, { error: "forbidden", message: "Managing content assets requires owner access." });
    }
    try {
      if (isMultipart(request)) {
        const result = await saveUploadedAsset({ request, env, repo, userId: user.id });
        return json(result.status, result.body);
      }
      const body = await readBody(request);
      const result = await repo.saveAsset(body || {}, user.id);
      if (!result.ok) return json(400, { error: result.error });
      return json(200, { ...result, asset: withPublicUrl(env, result.asset) });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  return json(405, { error: "method_not_allowed" });
}

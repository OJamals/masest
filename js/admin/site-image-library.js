import { canonicalPublicImageUrl } from "../image-url.js?v=20260804b";

export const SITE_IMAGE_MANIFEST_URL = "/data/content/site-images.json";
const MAX_UPLOAD_EDGE = 2560;
const UPLOAD_WEBP_QUALITY = 0.94;

let defaultManifestPromise;

export async function prepareImageUpload(file) {
  if (!globalThis.createImageBitmap || !file?.type?.startsWith("image/")) {
    return { file, width: null, height: null };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { file, width: null, height: null };
  }
  try {
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale === 1 && file.type !== "image/jpeg") return { file, width, height };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("image_normalization_failed");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("image_normalization_failed")),
        "image/webp",
        UPLOAD_WEBP_QUALITY,
      );
    });
    const name = String(file.name || "asset").replace(/\.[^.]+$/, "") || "asset";
    return {
      file: new File([blob], `${name}.webp`, { type: "image/webp", lastModified: file.lastModified }),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

function normalizedAsset(asset = {}, source = "site") {
  const publicUrl = canonicalPublicImageUrl(asset.public_url || asset.source_url || asset.storage_path);
  if (!publicUrl) return null;
  return {
    ...asset,
    storage_path: source === "site"
      ? canonicalPublicImageUrl(asset.storage_path || publicUrl)
      : (asset.storage_path || publicUrl),
    public_url: publicUrl,
    source,
    status: asset.status || "available",
  };
}

function assetIdentity(asset = {}) {
  const storagePath = canonicalPublicImageUrl(asset.storage_path);
  return storagePath || asset.public_url;
}

function searchableAssetText(asset) {
  return [
    asset.public_url,
    asset.storage_path,
    asset.filename,
    asset.alt,
    asset.category,
    ...(Array.isArray(asset.usage) ? asset.usage : []),
    ...(Array.isArray(asset.references)
      ? asset.references.flatMap((reference) => [
        reference.title,
        reference.type,
        reference.slug,
        ...(reference.fields || []),
      ])
      : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function assetUrl(asset = {}) {
  return canonicalPublicImageUrl(asset.public_url || asset.source_url || asset.storage_path);
}

export function formatAssetBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = bytes < 1024 * 1024 ? ["KB", 1024] : ["MB", 1024 * 1024];
  const amount = (bytes / units[1]).toFixed(1).replace(/\.0$/, "");
  return `${amount} ${units[0]}`;
}

export function mergeSiteImageAssets({
  cmsAssets = [],
  siteAssets = [],
  q = "",
  status = "available",
} = {}) {
  const assetsByUrl = new Map();
  for (const asset of siteAssets) {
    const normalized = normalizedAsset(asset, "site");
    if (normalized) assetsByUrl.set(assetIdentity(normalized), normalized);
  }
  for (const asset of cmsAssets) {
    const normalized = normalizedAsset(asset, "cms");
    if (normalized) assetsByUrl.set(assetIdentity(normalized), normalized);
  }

  const wantedStatus = String(status || "").trim();
  const search = String(q || "").trim().toLowerCase();
  return [...assetsByUrl.values()]
    .filter((asset) => !wantedStatus || wantedStatus === "all" || asset.status === wantedStatus)
    .filter((asset) => !search || searchableAssetText(asset).includes(search))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "cms" ? -1 : 1;
      if (a.source === "cms") {
        const byDate = String(b.created_at || "").localeCompare(String(a.created_at || ""));
        if (byDate) return byDate;
      }
      return a.public_url.localeCompare(b.public_url);
    });
}

export async function loadSiteImageAssets(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return [];
  const load = async () => {
    const response = await fetchImpl(SITE_IMAGE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`site_image_manifest_${response.status}`);
    const manifest = await response.json();
    return Array.isArray(manifest.assets) ? manifest.assets : [];
  };
  if (fetchImpl !== globalThis.fetch) return load();
  defaultManifestPromise ||= load().catch((error) => {
    defaultManifestPromise = undefined;
    throw error;
  });
  return defaultManifestPromise;
}

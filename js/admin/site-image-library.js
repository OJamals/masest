import { canonicalPublicImageUrl } from "../image-url.js?v=20260724f";

export const SITE_IMAGE_MANIFEST_URL = "/data/content/site-images.json";

let defaultManifestPromise;

function normalizedAsset(asset = {}, source = "site") {
  const publicUrl = canonicalPublicImageUrl(asset.public_url || asset.storage_path);
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

function searchableAssetText(asset) {
  return [
    asset.public_url,
    asset.storage_path,
    asset.filename,
    asset.alt,
    asset.category,
    ...(Array.isArray(asset.usage) ? asset.usage : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function assetUrl(asset = {}) {
  return canonicalPublicImageUrl(asset.public_url || asset.storage_path);
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
    if (normalized) assetsByUrl.set(normalized.public_url, normalized);
  }
  for (const asset of cmsAssets) {
    const normalized = normalizedAsset(asset, "cms");
    if (normalized) assetsByUrl.set(normalized.public_url, normalized);
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

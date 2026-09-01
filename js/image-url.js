export const CONTENT_ASSET_PUBLIC_BASE = "https://media.masest.co";
export const SITE_MEDIA_BASE = `${CONTENT_ASSET_PUBLIC_BASE}/site`;

const LEGACY_CONTENT_ASSET_PREFIX = "/storage/v1/object/public/content-assets/";
const MANAGED_IMAGE_URL_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/content-assets|media\.masest\.co)\/[a-z0-9_./%()+@-]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s"'<>)]*)?/gi;

export function canonicalPublicImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(?:javascript|data|vbscript):/i.test(raw)) return "";
  if (/^(?:https?:)?\/\//i.test(raw) || /^blob:/i.test(raw) || raw.startsWith("/")) {
    return raw;
  }
  const publicImage = raw.match(/^(?:\.{1,2}\/)*(img\/.+)$/i);
  return publicImage ? `/${publicImage[1]}` : raw;
}

function normalizedPublicBase(value = CONTENT_ASSET_PUBLIC_BASE) {
  const raw = String(value || CONTENT_ASSET_PUBLIC_BASE).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return "";
  }
}

function normalizedStoragePath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!path) return "";
  try {
    const decoded = path.split("/").map(decodeURIComponent).join("/");
    return decoded.split("/").some((part) => !part || part === "." || part === "..") ? "" : decoded;
  } catch {
    return "";
  }
}

export function managedContentAssetPath(value, publicBase = CONTENT_ASSET_PUBLIC_BASE) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return "";
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith(LEGACY_CONTENT_ASSET_PREFIX)) {
    return normalizedStoragePath(url.pathname.slice(LEGACY_CONTENT_ASSET_PREFIX.length));
  }

  try {
    const base = new URL(`${normalizedPublicBase(publicBase)}/`);
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return "";
    return normalizedStoragePath(url.pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

export function contentAssetPublicUrl(storagePath, publicBase = CONTENT_ASSET_PUBLIC_BASE) {
  const base = normalizedPublicBase(publicBase);
  if (!base) return "";
  const canonical = canonicalPublicImageUrl(storagePath);
  const path = /^\/img\//i.test(canonical)
    ? normalizedStoragePath(`site${canonical.split(/[?#]/, 1)[0]}`)
    : normalizedStoragePath(canonical.split(/[?#]/, 1)[0]);
  if (!path) return "";
  return `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function canonicalContentAssetUrl(value, publicBase = CONTENT_ASSET_PUBLIC_BASE) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const managedPath = managedContentAssetPath(raw, publicBase);
  if (managedPath) {
    const url = new URL(raw);
    const publicUrl = contentAssetPublicUrl(managedPath, publicBase);
    return publicUrl ? `${publicUrl}${url.search}${url.hash}` : "";
  }

  const canonical = canonicalPublicImageUrl(raw);
  if (!/^\/img\//i.test(canonical)) return canonical;
  const url = new URL(canonical, "https://logical.masest.invalid");
  return `${contentAssetPublicUrl(`site${url.pathname}`, publicBase)}${url.search}${url.hash}`;
}

export function cmsPublicImageUrl(value, mediaBase = SITE_MEDIA_BASE) {
  const canonical = canonicalPublicImageUrl(value);
  const base = normalizedPublicBase(mediaBase || SITE_MEDIA_BASE);
  if (!canonical || !base) return canonical;
  const publicBase = base.replace(/\/site$/i, "");
  const managedPath = managedContentAssetPath(canonical, publicBase);
  if (managedPath) {
    const url = new URL(canonical);
    const managedBase = managedPath.startsWith("site/") ? base : publicBase;
    const relativePath = managedPath.startsWith("site/") ? managedPath.slice(5) : managedPath;
    return `${managedBase}/${relativePath.split("/").map(encodeURIComponent).join("/")}${url.search}${url.hash}`;
  }
  if (/^\/img\//i.test(canonical)) return `${base}${canonical}`;
  if (/^https?:\/\/(?:www\.)?masest\.co\//i.test(canonical)) {
    const url = new URL(canonical);
    return /^\/img\//i.test(url.pathname) ? `${base}${url.pathname}${url.search}${url.hash}` : canonical;
  }
  return canonical;
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteCmsImageReferences(content, publicPaths = [], mediaBase = "") {
  let rewritten = String(content || "").replace(
    MANAGED_IMAGE_URL_PATTERN,
    (value) => cmsPublicImageUrl(value, mediaBase || SITE_MEDIA_BASE),
  );
  for (const value of publicPaths) {
    const logical = canonicalPublicImageUrl(value).split(/[?#]/, 1)[0];
    if (!/^\/img\//i.test(logical)) continue;
    const relative = logical.slice(1);
    const variants = [
      `https://www.masest.co${logical}`,
      `https://masest.co${logical}`,
      `http://www.masest.co${logical}`,
      `http://masest.co${logical}`,
      ...Array.from({ length: 7 }, (_, depth) => `${"../".repeat(depth)}${relative}`),
      logical,
    ].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_./-])(?:${variants.map(escapedPattern).join("|")})(?![A-Za-z0-9_.-])`,
      "g",
    );
    rewritten = rewritten.replace(pattern, cmsPublicImageUrl(logical, mediaBase));
  }
  return rewritten;
}

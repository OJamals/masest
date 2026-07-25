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

export function cmsPublicImageUrl(value, mediaBase) {
  const canonical = canonicalPublicImageUrl(value);
  const base = String(mediaBase || "").trim().replace(/\/+$/, "");
  if (!canonical || !base) return canonical;
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
  let rewritten = String(content || "");
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

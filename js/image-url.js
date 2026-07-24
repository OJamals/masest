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

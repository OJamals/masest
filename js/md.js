// Minimal zero-dependency Markdown → HTML for CMS-authored blog bodies.
// Browser- and Node-safe (pure JS, no platform APIs). Single source of truth:
// tools/_md.mjs re-exports this so the static build and the admin live preview
// render identically. Supports: #..#### headings, **bold**, *italic*, `code`,
// fenced ``` blocks, [links](url), ![images](url), - / * / 1. lists,
// > blockquotes, --- hr, paragraphs. All text is HTML-escaped before markup is
// applied; no raw-HTML passthrough. Known limitation: inline markup is not
// suppressed inside inline `code` spans (acceptable for authored content).

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// url is already HTML-escaped by inline(); block dangerous schemes.
function isSafeUrl(url) {
  const u = url.trim().toLowerCase();
  return !/^(javascript|data|vbscript):/i.test(u);
}

function inline(src) {
  let s = escapeHtml(src);
  // URL char class allows one level of balanced parens (e.g. javascript:alert(1)).
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_m, alt, url) =>
    isSafeUrl(url) ? `<img src="${url.trim()}" alt="${alt}" width="1200" height="675" loading="lazy" decoding="async">` : alt);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_m, txt, url) =>
    isSafeUrl(url) ? `<a href="${url.trim()}">${txt}</a>` : txt);
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\+\+([^+]+)\+\+/g, "<u>$1</u>");
  s = s.replace(/\[\[size:(14|16|18|20|24|32)\|([^\]]+)\]\]/g, (_m, size, text) =>
    `<span data-md-size="${size}" style="font-size:${size}px">${text}</span>`);
  s = s.replace(/\[\[color:(#[0-9a-fA-F]{3,6})\|([^\]]+)\]\]/g, (_m, color, text) =>
    `<span data-md-color="${color}" style="color:${color}">${text}</span>`);
  return s;
}

function cardAttrs(src) {
  const raw = String(src || "").trim();
  const match = raw.match(/^\[\[card:([\s\S]+)\]\]$/);
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split("|")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    fields[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  const href = fields.href || "";
  if (!fields.title || !href || !isSafeUrl(href)) return null;
  return fields;
}

function renderCard(fields = {}) {
  const title = escapeHtml(fields.title || "Reference");
  const href = escapeHtml(fields.href || "#");
  const image = fields.image && isSafeUrl(fields.image) ? escapeHtml(fields.image) : "";
  const alt = escapeHtml(fields.alt || fields.title || "Reference");
  return `<a class="md-card" href="${href}" data-md-card data-md-title="${title}" data-md-image="${image}" data-md-alt="${alt}">
    ${image ? `<img src="${image}" alt="${alt}" width="1200" height="675" loading="lazy" decoding="async">` : `<span class="md-card-thumb" aria-hidden="true"></span>`}
    <span><strong>${title}</strong><small>${href}</small></span>
  </a>`;
}

const BLOCK_START = /^(#{1,4}\s|```|\s*>|\s*[-*]\s|\s*\d+\.\s)/;
const HR = /^\s*(?:---|\*\*\*|___)\s*$/;

export function renderMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    if (HR.test(line)) { out.push("<hr>"); i++; continue; }
    const card = cardAttrs(line);
    if (card) { out.push(renderCard(card)); i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>\n${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i]) && !HR.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function readingTime(src) {
  const words = String(src ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

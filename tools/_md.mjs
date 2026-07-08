// Minimal zero-dependency Markdown → HTML for CMS-authored blog bodies.
// Supports: #..#### headings, **bold**, *italic*, `code`, fenced ``` blocks,
// [links](url), ![images](url), - / * / 1. lists, > blockquotes, --- hr,
// paragraphs. All text is HTML-escaped before markup is applied; no raw-HTML
// passthrough. Known limitation: inline markup is not suppressed inside inline
// `code` spans (acceptable for v1 authored content).

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
    isSafeUrl(url) ? `<img src="${url.trim()}" alt="${alt}" loading="lazy" decoding="async">` : alt);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_m, txt, url) =>
    isSafeUrl(url) ? `<a href="${url.trim()}">${txt}</a>` : txt);
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
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

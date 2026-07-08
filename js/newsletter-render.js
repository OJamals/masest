// Trusted-author Markdown → HTML for staff-written newsletter bodies. Browser- and
// Node-safe (pure, no imports) so the admin live preview and the server send render
// identically. Unlike the public blog renderer this does NOT escape raw HTML — staff
// can drop in <div style="text-align:center">, <img>, tables, etc. for layout.
// Supports #..#### headings, **bold**, *italic*, `code`, [links](url), ![img](url),
// - / 1. lists, > quotes, --- hr, paragraphs; a block starting with '<' passes through.
const INLINE_CODE = /`([^`]+)`/g;

export function renderNewsletterBody(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n{2,}/);
  const inline = (t) => String(t)
    .replace(INLINE_CODE, (_m, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, a, u) => `<img src="${u.trim()}" alt="${a}" style="max-width:100%;height:auto">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, x, u) => `<a href="${u.trim()}">${x}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (block.startsWith('<')) { out.push(block); continue; }
    if (/^-{3,}$/.test(block)) { out.push('<hr>'); continue; }
    const h = block.match(/^(#{1,4})\s+(.+)$/);
    if (h && !block.includes('\n')) { out.push(`<h${h[1].length} style="margin:16px 0 8px">${inline(h[2])}</h${h[1].length}>`); continue; }
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }
    if (lines.every((l) => /^\s*>\s?/.test(l))) {
      out.push(`<blockquote style="border-left:3px solid #0e7c86;margin:12px 0;padding:2px 14px;color:#555">${inline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join(' '))}</blockquote>`);
      continue;
    }
    out.push(`<p style="margin:0 0 12px">${inline(lines.join(' '))}</p>`);
  }
  return out.join('\n');
}

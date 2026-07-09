// Trusted-author Markdown → HTML for staff-written newsletter bodies. Browser- and
// Node-safe (pure, no imports) so the admin live preview and the server send render
// identically. Unlike the public blog renderer this does NOT escape raw HTML — staff
// can drop in <div style="text-align:center">, <img>, tables, etc. for layout.
// Supports #..#### headings, **bold**, *italic*, ++underline++, size/color spans,
// `code`, [links](url), ![img](url), link cards, - / 1. lists, > quotes, --- hr,
// paragraphs; a block starting with '<' passes through.
const INLINE_CODE = /`([^`]+)`/g;

function cardAttrs(src) {
  const raw = String(src || '').trim();
  const match = raw.match(/^\[\[card:([\s\S]+)\]\]$/);
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split('|')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    fields[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  if (!fields.title || !fields.href) return null;
  return fields;
}

function renderCard(fields = {}) {
  const title = fields.title || 'Reference';
  const href = fields.href || '#';
  const image = fields.image || '';
  const alt = fields.alt || title;
  return `<a class="md-card" href="${href}" data-md-card data-md-title="${title}" data-md-image="${image}" data-md-alt="${alt}" style="display:flex;gap:12px;align-items:center;text-decoration:none;border:1px solid #d9e2e4;border-radius:10px;padding:10px;margin:12px 0;color:inherit">
    ${image ? `<img src="${image}" alt="${alt}" style="width:72px;height:54px;object-fit:cover;border-radius:8px">` : `<span style="width:72px;height:54px;border-radius:8px;background:#eef5f6;display:inline-block"></span>`}
    <span><strong>${title}</strong><br><small>${href}</small></span>
  </a>`;
}

export function renderNewsletterBody(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n{2,}/);
  const inline = (t) => String(t)
    .replace(INLINE_CODE, (_m, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, a, u) => `<img src="${u.trim()}" alt="${a}" style="max-width:100%;height:auto">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, x, u) => `<a href="${u.trim()}">${x}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>')
    .replace(/\[\[size:(14|16|18|20|24|32)\|([^\]]+)\]\]/g, (_m, size, text) => `<span style="font-size:${size}px">${text}</span>`)
    .replace(/\[\[color:(#[0-9a-fA-F]{3,6})\|([^\]]+)\]\]/g, (_m, color, text) => `<span style="color:${color}">${text}</span>`);
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (block.startsWith('<')) { out.push(block); continue; }
    if (/^-{3,}$/.test(block)) { out.push('<hr>'); continue; }
    const card = cardAttrs(block);
    if (card) { out.push(renderCard(card)); continue; }
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

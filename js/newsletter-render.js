// Conservative newsletter Markdown → HTML renderer. Browser- and Node-safe (pure,
// no imports) so admin preview and server delivery consume identical output.
// Author input is always escaped; only renderer-owned tags, attributes, styles,
// and validated URLs reach HTML.
const LINK_SCHEMES = new Set(['https:', 'http:', 'mailto:', 'tel:']);
const IMAGE_SCHEMES = new Set(['https:', 'http:']);
const CARD_FIELDS = new Set(['title', 'href', 'image', 'alt']);
const URL_BASE = 'https://newsletter-render.invalid';
const ENTITY_REFERENCE = /&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/i;
const INVALID_PERCENT = /%(?![0-9a-f]{2})/i;
const ENCODED_UNSAFE = /%(?:0[0-9a-f]|1[0-9a-f]|22|27|3c|3e|5c|7f)/i;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function safeUrl(raw, allowedSchemes) {
  const value = String(raw ?? '');
  if (
    !value
    || value !== value.trim()
    || /[\s\u0000-\u001f\u007f-\u009f\\<>"'`]/u.test(value)
    || ENTITY_REFERENCE.test(value)
    || INVALID_PERCENT.test(value)
    || ENCODED_UNSAFE.test(value)
  ) return null;
  try {
    encodeURI(value);
  } catch {
    return null;
  }

  if (value.startsWith('/')) {
    if (value.startsWith('//')) return null;
    try {
      const parsed = new URL(value, URL_BASE);
      if (parsed.origin !== URL_BASE) return null;
      return { value, external: false };
    } catch {
      return null;
    }
  }

  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return null;
  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  if (!allowedSchemes.has(scheme)) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== scheme) return null;
    if (scheme === 'http:' || scheme === 'https:') {
      if (!/^https?:\/\//i.test(value) || !parsed.hostname) return null;
      return { value, external: true };
    }
    const target = value.slice(scheme.length);
    if (!target || target.startsWith('//') || !parsed.pathname) return null;
    return { value, external: false };
  } catch {
    return null;
  }
}

function urlAttrs(raw, allowedSchemes) {
  const url = safeUrl(raw, allowedSchemes);
  if (!url) return null;
  return {
    value: escapeHtml(url.value),
    rel: url.external ? ' rel="noopener noreferrer"' : '',
  };
}

function cardAttrs(src) {
  const raw = String(src ?? '').trim();
  const match = raw.match(/^\[\[card:([\s\S]+)\]\]$/);
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split('|')) {
    const index = part.indexOf('=');
    if (index <= 0) return null;
    const key = part.slice(0, index).trim();
    if (!CARD_FIELDS.has(key) || Object.hasOwn(fields, key)) return null;
    fields[key] = part.slice(index + 1).trim();
  }
  if (!fields.title || !fields.href) return null;
  return fields;
}

function renderCard(fields) {
  const href = urlAttrs(fields.href, LINK_SCHEMES);
  const image = fields.image ? urlAttrs(fields.image, IMAGE_SCHEMES) : null;
  if (!href) return null;

  const title = escapeHtml(fields.title);
  const alt = escapeHtml(fields.alt || fields.title);
  const imageValue = image?.value || '';
  return `<a class="md-card" href="${href.value}"${href.rel} data-md-card data-md-title="${title}" data-md-image="${imageValue}" data-md-alt="${alt}" style="display:flex;gap:12px;align-items:center;text-decoration:none;border:1px solid #d9e2e4;border-radius:10px;padding:10px;margin:12px 0;color:inherit">
    ${image ? `<img src="${image.value}" alt="${alt}" width="72" height="54" style="width:72px;height:54px;object-fit:cover;border-radius:8px">` : '<span style="width:72px;height:54px;border-radius:8px;background:#eef5f6;display:inline-block"></span>'}
    <span><strong>${title}</strong><br><small>${href.value}</small></span>
  </a>`;
}

function markdownTarget(source, start, image) {
  const labelStart = start + (image ? 2 : 1);
  const labelEnd = source.indexOf('](', labelStart);
  if (labelEnd === -1 || (!image && labelEnd === labelStart)) return null;
  const urlEnd = source.indexOf(')', labelEnd + 2);
  if (urlEnd === -1) return null;
  return {
    label: source.slice(labelStart, labelEnd),
    url: source.slice(labelEnd + 2, urlEnd),
    end: urlEnd + 1,
  };
}

function renderInline(value, depth = 0, allowUrls = true) {
  const source = String(value ?? '');
  if (depth > 8) return escapeHtml(source);
  let html = '';
  let index = 0;

  while (index < source.length) {
    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1);
      if (end > index + 1) {
        html += `<code>${escapeHtml(source.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }

    if (allowUrls && source.startsWith('![', index)) {
      const target = markdownTarget(source, index, true);
      if (target) {
        const src = urlAttrs(target.url, IMAGE_SCHEMES);
        if (src) {
          html += `<img src="${src.value}" alt="${escapeHtml(target.label)}" width="1200" height="675" style="max-width:100%;height:auto">`;
        } else {
          html += escapeHtml(source.slice(index, target.end));
        }
        index = target.end;
        continue;
      }
    }

    if (allowUrls && source[index] === '[') {
      const target = markdownTarget(source, index, false);
      if (target) {
        const href = urlAttrs(target.url, LINK_SCHEMES);
        if (href) {
          html += `<a href="${href.value}"${href.rel}>${renderInline(target.label, depth + 1, false)}</a>`;
        } else {
          html += escapeHtml(source.slice(index, target.end));
        }
        index = target.end;
        continue;
      }
    }

    if (source.startsWith('[[size:', index)) {
      const match = source.slice(index).match(/^\[\[size:(14|16|18|20|24|32)\|([^\]]+)\]\]/);
      if (match) {
        html += `<span style="font-size:${match[1]}px">${renderInline(match[2], depth + 1, allowUrls)}</span>`;
        index += match[0].length;
        continue;
      }
    }

    if (source.startsWith('[[color:', index)) {
      const match = source.slice(index).match(/^\[\[color:(#[0-9a-f]{3}|#[0-9a-f]{6})\|([^\]]+)\]\]/i);
      if (match) {
        html += `<span style="color:${match[1]}">${renderInline(match[2], depth + 1, allowUrls)}</span>`;
        index += match[0].length;
        continue;
      }
    }

    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2);
      if (end > index + 2) {
        html += `<strong>${renderInline(source.slice(index + 2, end), depth + 1, allowUrls)}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (source[index] === '*') {
      const end = source.indexOf('*', index + 1);
      if (end > index + 1) {
        html += `<em>${renderInline(source.slice(index + 1, end), depth + 1, allowUrls)}</em>`;
        index = end + 1;
        continue;
      }
    }

    if (source.startsWith('++', index)) {
      const end = source.indexOf('++', index + 2);
      if (end > index + 2) {
        html += `<u>${renderInline(source.slice(index + 2, end), depth + 1, allowUrls)}</u>`;
        index = end + 2;
        continue;
      }
    }

    html += escapeHtml(source[index]);
    index += 1;
  }

  return html;
}

export function renderNewsletterBody(md) {
  const source = String(md ?? '').replace(/\r\n?/g, '\n');
  const blocks = source.split(/\n{2,}/);
  const output = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (/^-{3,}$/.test(block)) {
      output.push('<hr>');
      continue;
    }

    const fields = cardAttrs(block);
    if (fields) {
      const card = renderCard(fields);
      if (card) {
        output.push(card);
        continue;
      }
    }

    const heading = block.match(/^(#{1,4})\s+(.+)$/);
    if (heading && !block.includes('\n')) {
      const level = heading[1].length;
      output.push(`<h${level} style="margin:16px 0 8px">${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      output.push(`<ul>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      output.push(`<ol>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }
    if (lines.every((line) => /^\s*>\s?/.test(line))) {
      const quote = lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' ');
      output.push(`<blockquote style="border-left:3px solid #0e7c86;margin:12px 0;padding:2px 14px;color:#555">${renderInline(quote)}</blockquote>`);
      continue;
    }
    output.push(`<p style="margin:0 0 12px">${renderInline(lines.join(' '))}</p>`);
  }

  return output.join('\n');
}

// Newsletter platform: pure helpers (render, audience resolution, schedule math)
// shared by the admin endpoints + the cron sweep. I/O is injected by callers.
import { emailLayout, htmlEscape } from './supabase.js';

const BASE = 'https://masest.co';
const INLINE_CODE = /`([^`]+)`/g;

// Trusted-author Markdown → HTML for staff-written newsletter bodies. Unlike the
// public blog renderer this does NOT escape raw HTML — staff can drop in <div
// style="text-align:center">, <img>, tables, etc. for layout/alignment. Supports
// #..### headings, **bold**, *italic*, `code`, [links](url), ![img](url), - lists,
// > quotes, --- hr, paragraphs; any block starting with '<' passes through verbatim.
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
    if (block.startsWith('<')) { out.push(block); continue; } // raw HTML passthrough
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

// Full email: subject + branded shell around the rendered body.
export function renderNewsletterEmail(newsletter = {}) {
  const subject = String(newsletter.subject || 'The VertKleen Briefing').slice(0, 180);
  const bodyHtml = renderNewsletterBody(newsletter.body_md);
  const html = emailLayout({ heading: htmlEscape(subject), bodyHtml });
  return { subject, html };
}

// Resolve the send audience: union of the selected populations, deduped + lowercased,
// minus suppressed/unsubscribed. All lists are injected (already fetched by the caller).
// populations: array subset of ['users','leads','imported'].
export function resolveAudience({ populations = [], users = [], leads = [], imported = [], suppressed = [] } = {}) {
  const want = new Set(populations);
  const drop = new Set((suppressed || []).map((e) => String(e).toLowerCase()));
  const out = [];
  const seen = new Set();
  const add = (list) => {
    for (const e of list || []) {
      const email = String(e || '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen.has(email) || drop.has(email)) continue;
      seen.add(email); out.push(email);
    }
  };
  if (want.has('users')) add(users);
  if (want.has('leads')) add(leads);
  if (want.has('imported')) add(imported);
  return out;
}

// Next run for a recurring schedule (interval in days). Returns ISO string or null.
export function nextRunAt(schedule = {}, fromMs = Date.now()) {
  if (schedule.mode !== 'recurring') return null;
  const days = Math.max(1, Number(schedule.interval_days) || 0);
  if (!days) return null;
  return new Date(fromMs + days * 86400000).toISOString();
}

// Scheduled newsletters whose next_run_at is due.
export function dueNewsletters(newsletters = [], nowMs = Date.now()) {
  return (newsletters || []).filter((n) => {
    if (!n || n.status !== 'scheduled') return false;
    const at = n.schedule?.next_run_at || n.schedule?.send_at;
    return at && Date.parse(at) <= nowMs;
  });
}

export { BASE as NEWSLETTER_BASE };

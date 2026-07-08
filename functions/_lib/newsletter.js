// Newsletter platform: pure helpers (render, audience resolution, schedule math)
// shared by the admin endpoints + the cron sweep. I/O is injected by callers.
import { emailLayout, htmlEscape } from './supabase.js';
// Shared browser+node renderer so the admin preview and the server send match exactly.
import { renderNewsletterBody } from '../../js/newsletter-render.js';

const BASE = 'https://masest.co';

export { renderNewsletterBody };

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

// Newsletter platform: pure helpers (render, audience resolution, schedule math)
// shared by the admin endpoints + the cron sweep. I/O is injected by callers.
import { emailLayout, htmlEscape } from './supabase.js';
// Shared browser+node renderer so the admin preview and the server send match exactly.
import { renderNewsletterBody } from '../../js/newsletter-render.js';

const BASE = 'https://masest.co';
export const NEWSLETTER_SEND_LEASE_MS = 15 * 60 * 1000;

export { renderNewsletterBody };

// Full email: subject + branded shell around the rendered body.
export function renderNewsletterEmail(newsletter = {}) {
  const subject = String(newsletter.subject || 'The VertKlean Briefing').slice(0, 180);
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

// Stable slice math for newsletter delivery. Large audiences continue across cron
// runs instead of silently dropping every recipient after the worker-safe batch cap.
export function newsletterBatchPlan(total, offset = 0, limit = 500) {
  const count = Math.max(0, Number(total) || 0);
  const start = Math.min(count, Math.max(0, Number(offset) || 0));
  const size = Math.max(1, Number(limit) || 500);
  const end = Math.min(count, start + size);
  return { start, end, nextOffset: end, capped: end < count };
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

// Scheduled work is immediately claimable. A send left in `sending` is reclaimable
// only after its lease expires. Provider idempotency keys make replaying that slice safe.
export function newsletterSendCandidates(newsletters = [], nowMs = Date.now(), leaseMs = NEWSLETTER_SEND_LEASE_MS) {
  return (newsletters || []).filter((n) => {
    if (!n) return false;
    if (n.status === 'scheduled') {
      const at = n.schedule?.next_run_at || n.schedule?.send_at;
      return Boolean(at && Date.parse(at) <= nowMs);
    }
    if (n.status !== 'sending' || !n.updated_at) return false;
    const updatedAt = Date.parse(n.updated_at);
    return Number.isFinite(updatedAt) && updatedAt <= nowMs - Math.max(1000, Number(leaseMs) || NEWSLETTER_SEND_LEASE_MS);
  });
}

export { BASE as NEWSLETTER_BASE };

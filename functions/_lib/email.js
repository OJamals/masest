// functions/_lib/email.js — pure, dependency-free email helpers (unit-tested by execution).

const RESEND_STATUS = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // A send Resend accepts can still permanently fail or stall in delivery; capture those
  // so a row never stays 'sent' forever (these signals were previously dropped → null).
  "email.failed": "failed",
  "email.delivery_delayed": "delayed",
};

// Derive a readable text/plain alternative from a branded HTML email body. Multipart
// mail (text + html) scores better with spam filters and serves plain-text clients and
// screen readers. Best-effort, not a full HTML parser: drops style/script, turns links
// into "label (url)", maps block-level tags to line breaks, strips remaining tags, and
// decodes the handful of entities our templates emit. Returns '' for empty/blank input.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–' };

export function htmlToText(html) {
  let s = String(html || '');
  if (!s.trim()) return '';
  s = s.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // <a href="url">label</a> → "label (url)", but skip when the label already is the url.
  s = s.replace(/<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
    const text = label.replace(/<[^>]+>/g, '').trim();
    const url = String(href).trim();
    if (!url || url.startsWith('mailto:') || text === url) return text || url;
    return `${text} (${url})`;
  });
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|table|thead|tbody)\s*>/gi, '\n');
  s = s.replace(/<\s*(li)\b[^>]*>/gi, '• ');
  s = s.replace(/<td\b[^>]*>/gi, '  ').replace(/<\/td\s*>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(#?\w+);/g, (m, e) => (e in ENTITIES ? ENTITIES[e] : m));
  // Collapse runs of spaces/tabs, trim each line, cap consecutive blank lines at one.
  s = s.replace(/[ \t]+/g, ' ').split('\n').map((l) => l.trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

// Returns recipients not present in the suppression set (case-insensitive on email).
export function filterSuppressed(recipients, suppressedSet) {
  if (!Array.isArray(recipients)) return [];
  return recipients.filter((addr) => !suppressedSet.has(String(addr).toLowerCase()));
}

// Categories a recipient may opt out of without losing transactional mail. Everything
// else (order, billing, team, staff alerts, lead auto-reply) is transactional.
export const MARKETING_CATEGORIES = new Set(['lead_followup', 'lead_followup_reminder', 'offer']);

export function categoryStream(category) {
  return MARKETING_CATEGORIES.has(String(category)) ? 'marketing' : 'transactional';
}

// Per-stream suppression filter. `suppressionMap` is Map<emailLower, Set<stream>>.
// 'all' (hard bounce/complaint) blocks every category; 'marketing' (unsubscribe) blocks
// only marketing categories, so a marketing opt-out never kills order/billing receipts.
export function filterByStream(recipients, category, suppressionMap) {
  if (!Array.isArray(recipients)) return [];
  const marketing = categoryStream(category) === 'marketing';
  return recipients.filter((addr) => {
    const streams = suppressionMap && suppressionMap.get(String(addr).toLowerCase());
    if (!streams) return true;
    if (streams.has('all')) return false;
    if (marketing && streams.has('marketing')) return false;
    return true;
  });
}

// Signed unsubscribe token: HMAC-SHA256(email) hex. Lets the one-click endpoint suppress
// only addresses we actually emailed — not arbitrary ones. Async (SubtleCrypto).
export async function unsubscribeToken(email, secret) {
  if (!secret || !email) return '';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(email).toLowerCase()));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyUnsubscribeToken(email, token, secret) {
  if (!token) return false;
  const expected = await unsubscribeToken(email, secret);
  if (!expected || expected.length !== String(token).length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ String(token).charCodeAt(i);
  return diff === 0;
}

// Maps a Resend webhook event type to an internal email_events.status, or null for
// unknown events (which leave the row's status untouched).
export function mapResendEvent(type) {
  return RESEND_STATUS[type] || null;
}

// Event types that mean the address should be suppressed.
export function isSuppressingEvent(type) {
  return type === "email.bounced" || type === "email.complained";
}

// True when `timestampSeconds` (Unix seconds) is within `toleranceSec` of now. Used to
// reject replayed webhook payloads — a captured valid signature is worthless once stale.
// `nowMs` is injectable for deterministic tests.
export function isFreshTimestamp(timestampSeconds, toleranceSec = 300, nowMs = Date.now()) {
  const ts = Number(timestampSeconds);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  return Math.abs(nowSec - ts) <= toleranceSec;
}

// Verifies a Svix (Resend) webhook signature. secret is "whsec_<base64>"; headers carry
// svix-id, svix-timestamp, and a space-separated svix-signature of "v1,<base64sig>" items.
// Signed content is `${id}.${timestamp}.${body}`. Rejects stale timestamps (replay guard,
// ±toleranceSec, default 5 min — Svix's recommendation) before checking the HMAC.
// Returns a boolean. Async (SubtleCrypto). `nowMs` is injectable for tests.
export async function verifySvixSignature(secret, { id, timestamp, signature }, body, { toleranceSec = 300, nowMs = Date.now() } = {}) {
  if (!secret || !id || !timestamp || !signature) return false;
  if (!isFreshTimestamp(timestamp, toleranceSec, nowMs)) return false;
  try {
    const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    const mac = await crypto.subtle.sign("HMAC", key, data);
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    const provided = signature.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
    return provided.some((sig) => timingSafeEqualStr(sig, expected));
  } catch {
    return false;
  }
}

// Constant-time string compare for MAC verification — never short-circuit on the first
// differing byte (avoids a timing oracle on the signature). MAC length is fixed/public.
function timingSafeEqualStr(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

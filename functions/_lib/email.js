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

// Returns recipients not present in the suppression set (case-insensitive on email).
export function filterSuppressed(recipients, suppressedSet) {
  if (!Array.isArray(recipients)) return [];
  return recipients.filter((addr) => !suppressedSet.has(String(addr).toLowerCase()));
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
    return provided.some((sig) => sig === expected);
  } catch {
    return false;
  }
}

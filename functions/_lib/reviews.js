// functions/_lib/reviews.js — pure helpers, no I/O. Unit-tested by execution.

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ENT[c]);
}

const TITLE_MAX = 120;
const BODY_MAX = 4000;
const NAME_MAX = 80;

export function validateReviewInput(input = {}) {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "invalid_rating" };
  }
  const sku = String(input.sku || "").trim();
  if (!sku) return { ok: false, error: "missing_sku" };
  const kind = String(input.kind || "product").trim().toLowerCase() === "service" ? "service" : "product";
  const title = String(input.title || "").trim().slice(0, TITLE_MAX);
  const body = String(input.body || "").trim().slice(0, BODY_MAX);
  const author_name = String(input.author_name || "").trim().slice(0, NAME_MAX);
  return { ok: true, value: { rating, sku, kind, title, body, author_name } };
}

// Subject binds a token to exactly one order+sku+email so an email link can authorize
// a single review without login. email lowercased for stable matching.
function tokenSubject({ orderId, sku, email }) {
  return `${String(orderId)}:${String(sku)}:${String(email || "").toLowerCase()}`;
}

export async function reviewToken(parts, secret) {
  if (!secret || !parts?.orderId || !parts?.sku) return "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(tokenSubject(parts)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyReviewToken(parts, token, secret) {
  if (!token || !secret) return false;
  const expected = await reviewToken(parts, secret);
  if (!expected || expected.length !== String(token).length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ String(token).charCodeAt(i);
  return diff === 0;
}

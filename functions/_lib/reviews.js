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

// An order proves purchase of `sku` only once it has shipped/settled as goods delivered.
// 'fulfilled' (settled + shipped) or tracking 'delivered' qualify; 'paid'/'cart' do not.
const ELIGIBLE_STATUS = new Set(["fulfilled"]);
const ELIGIBLE_TRACKING = new Set(["delivered"]);

export function findVerifiedOrderId(orders, sku) {
  for (const o of Array.isArray(orders) ? orders : []) {
    const eligible = ELIGIBLE_STATUS.has(o?.status) || ELIGIBLE_TRACKING.has(o?.tracking_status);
    if (!eligible) continue;
    const items = Array.isArray(o?.order_items) ? o.order_items : [];
    if (items.some((it) => it?.sku === sku)) return o.id;
  }
  return null;
}

export function aggregateStats(rows) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0, count = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = Number(r?.rating);
    if (n >= 1 && n <= 5) { dist[n] += 1; sum += n; count += 1; }
  }
  const avg = count ? Math.round((sum / count) * 10) / 10 : 0;
  return { avg, count, dist };
}

export const REMINDER_DELAY_DAYS = 10;

// A single-source-of-truth predicate mirroring the SQL the sweep uses to page orders.
// `refDate` (delivered→shipped_at, fulfilled→updated_at) must be ≥ REMINDER_DELAY_DAYS old.
export function isReminderDue(order, nowMs) {
  if (!order || order.review_reminded_at) return false;
  if (!String(order.customer_email || "").trim()) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.parse(new Date().toISOString());
  const cutoff = now - REMINDER_DELAY_DAYS * 86400000;
  const delivered = order.tracking_status === "delivered" && order.shipped_at && Date.parse(order.shipped_at) <= cutoff;
  const fulfilled = order.status === "fulfilled" && order.updated_at && Date.parse(order.updated_at) <= cutoff;
  return Boolean(delivered || fulfilled);
}

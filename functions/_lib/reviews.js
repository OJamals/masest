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

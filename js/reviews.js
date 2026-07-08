/* js/reviews.js - storefront review widget: star summary, review list, verified
 * write form, and per-item AggregateRating JSON-LD.
 *
 * Mount shape: <div data-reviews data-sku="..." data-kind="product|service"
 * [data-compact]></div>.
 *   - Full mode (default, used on product.html): summary + review list + a
 *     write form gated to a signed-in verified buyer.
 *   - Compact mode (used on the services.html line-item grid, where dozens of
 *     SKUs share one page): a star/average/count badge plus the JSON-LD only.
 *     Writing a service review happens through the emailed one-click link
 *     (review.html), not inline in the 39-card catalog grid.
 *
 * Auth: mirrors the real session accessor product.html and cart.html already
 * use - js/auth.js's getToken() (Supabase session token) gates the write form,
 * and js/auth.js's api() attaches the same Authorization: Bearer header the
 * rest of the authenticated storefront uses when it submits.
 */

const STAR_FULL = "★"; // filled star
const STAR_EMPTY = "☆"; // outline star

function starGlyphs(avg) {
  const full = Math.max(0, Math.min(5, Math.round(Number(avg) || 0)));
  return STAR_FULL.repeat(full) + STAR_EMPTY.repeat(5 - full);
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function jsonLdId(kind, sku) {
  return `rv-jsonld-${kind}-${sku}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function writeJsonLd(kind, sku, stats) {
  const id = jsonLdId(kind, sku);
  const existing = document.getElementById(id);
  if (!stats || !stats.count) {
    if (existing) existing.remove();
    return;
  }
  const el = existing || document.createElement("script");
  el.type = "application/ld+json";
  el.id = id;
  el.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": kind === "service" ? "Service" : "Product",
    sku,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: stats.avg,
      reviewCount: stats.count,
      bestRating: 5,
      worstRating: 1,
    },
  });
  if (!existing) document.head.appendChild(el);
}

function summaryHtml(stats, kind) {
  if (!stats.count) {
    return `<div class="rv-summary rv-empty">No reviews yet. Verified buyers can be the first to review this ${esc(kind)}.</div>`;
  }
  return `<div class="rv-summary">
    <span class="rv-stars" aria-hidden="true">${starGlyphs(stats.avg)}</span>
    <strong>${stats.avg.toFixed(1)}</strong>
    <span class="rv-count">${stats.count} review${stats.count === 1 ? "" : "s"}</span>
  </div>`;
}

function listHtml(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return "";
  return `<div class="rv-list">${reviews.map((r) => `
    <article class="rv-card">
      <div class="rv-card-head">
        <span class="rv-stars" aria-hidden="true">${starGlyphs(r.rating)}</span>
        ${r.verified_purchase ? '<span class="rv-badge">Verified buyer</span>' : ""}
      </div>
      ${r.title ? `<h4>${esc(r.title)}</h4>` : ""}
      ${r.body ? `<p>${esc(r.body)}</p>` : ""}
      <footer>${esc(r.author_name)} &middot; ${new Date(r.created_at).toLocaleDateString()}</footer>
    </article>`).join("")}</div>`;
}

// Only a signed-in, verified buyer can write from the storefront; everyone else
// sees a gate with a sign-in link. The href is root-absolute (JS-injected
// commerce links must be, per project convention) so it resolves from any page
// depth. Loads js/auth.js on demand so the Supabase SDK it pulls in never
// becomes part of a page's default module graph.
async function mountWriteForm(slot, sku, kind) {
  let token = null;
  try {
    const auth = await import("./auth.js");
    token = await auth.getToken();
  } catch {
    token = null;
  }
  if (!token) {
    slot.innerHTML = `<p class="rv-gate">Only verified buyers can review this ${esc(kind)}. <a href="/account.html">Sign in</a> to write one.</p>`;
    return;
  }
  slot.innerHTML = `
    <form class="rv-form">
      <label class="rv-field">Rating
        <select name="rating" required>
          <option value="5">5 stars</option>
          <option value="4">4 stars</option>
          <option value="3">3 stars</option>
          <option value="2">2 stars</option>
          <option value="1">1 star</option>
        </select>
      </label>
      <label class="rv-field">Title (optional)
        <input name="title" maxlength="120" placeholder="Sum it up in a few words">
      </label>
      <label class="rv-field">Review
        <textarea name="body" maxlength="4000" rows="4" placeholder="How did it work for you?"></textarea>
      </label>
      <button type="submit" class="btn btn-secondary btn-sm">Submit review</button>
      <span class="rv-msg" role="status" aria-live="polite"></span>
    </form>`;
  const form = slot.querySelector("form");
  const msg = slot.querySelector(".rv-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    msg.textContent = "Submitting...";
    try {
      const auth = await import("./auth.js");
      await auth.api("/api/reviews", {
        method: "POST",
        body: { sku, kind, rating: form.rating.value, title: form.title.value, body: form.body.value },
      });
      msg.textContent = "Thanks - your review is pending approval.";
      form.hidden = true;
    } catch (err) {
      const code = err && err.data && err.data.error;
      msg.textContent = code === "not_verified_purchaser"
        ? "Only verified buyers can review this item."
        : code === "already_reviewed"
          ? "You have already reviewed this item."
          : code === "rate_limited"
            ? "Too many submissions - try again in a few minutes."
            : "Could not submit your review. Try again.";
      btn.disabled = false;
    }
  });
}

async function renderFull(mount, sku, kind, data) {
  mount.innerHTML = `
    <h3 class="rv-title">Reviews</h3>
    ${summaryHtml(data.stats, kind)}
    ${listHtml(data.reviews)}
    <div class="rv-form-slot"></div>`;
  await mountWriteForm(mount.querySelector(".rv-form-slot"), sku, kind);
}

function renderCompact(mount, stats) {
  if (!stats.count) {
    mount.hidden = true;
    mount.innerHTML = "";
    return;
  }
  mount.hidden = false;
  mount.innerHTML = `<span class="rv-stars" aria-hidden="true">${starGlyphs(stats.avg)}</span>
    <b>${stats.avg.toFixed(1)}</b>
    <span class="rv-count">(${stats.count})</span>`;
}

/* Hydrate one [data-reviews] mount: fetch the aggregate + list for its
 * data-sku/data-kind, write the JSON-LD, and render full or compact markup.
 * Idempotent - safe to call more than once on the same mount (e.g. a caller
 * that sets data-sku after an async fetch, then hydrates explicitly, while a
 * generic initReviewMounts() scan is also wired on the page). */
export async function hydrateReviewMount(mount) {
  if (!mount || mount.dataset.rvHydrated === "1") return;
  const sku = (mount.getAttribute("data-sku") || "").trim();
  const kind = mount.getAttribute("data-kind") === "service" ? "service" : "product";
  if (!sku) return;
  mount.dataset.rvHydrated = "1";
  const compact = mount.hasAttribute("data-compact");
  try {
    const res = await fetch(`/api/reviews?sku=${encodeURIComponent(sku)}&kind=${encodeURIComponent(kind)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!data || data.ok === false) return;
    writeJsonLd(kind, sku, data.stats);
    if (compact) renderCompact(mount, data.stats);
    else await renderFull(mount, sku, kind, data);
  } catch {
    // Network failure: leave the mount as it was rather than show a broken widget.
  }
}

export function initReviewMounts(root) {
  (root || document).querySelectorAll("[data-reviews]").forEach((mount) => { hydrateReviewMount(mount); });
}

// Self-init for any page that ships a static [data-reviews] mount (data-sku
// already in the HTML) alongside a plain <script src="/js/reviews.js"> include.
// product.html and the services.html catalog resolve their SKU only after an
// async fetch, so they import this module and call hydrateReviewMount() /
// initReviewMounts() explicitly once data-sku is set instead of relying on this
// listener - see product.html and js/main/service-catalog.js.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => initReviewMounts(document));
}

const money = (value, currency = "usd") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: String(currency || "usd").toUpperCase(),
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value));

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[char]);

function productPath(row) {
  const slug = row.product_slug === "cr-hd" ? "crhd" : row.product_slug;
  return `products/${encodeURIComponent(slug)}`;
}

function rowMarkup(row) {
  const label = `${escapeHtml(row.product)} ${escapeHtml(row.pack)}`;
  const quote = row.quote_only
    ? `<a class="btn btn-secondary btn-sm" href="contact?type=quote&amp;sku=${encodeURIComponent(row.sku)}" aria-label="Request quote for ${label}">Request quote</a>`
    : `<a class="segment-buyable" href="${productPath(row)}" aria-label="Buy small pack of ${label}">Buy small pack</a>`;
  return `
    <tr data-segment-pricing-row>
      <th scope="row" data-label="Product"><b>${escapeHtml(row.product)}</b><span>${escapeHtml(row.sku)}</span></th>
      <td data-label="Application">${escapeHtml(row.application)}</td>
      <td data-label="Pack">${escapeHtml(row.pack)}</td>
      <td data-label="Price / gal"><strong>${money(row.price_per_gallon, row.currency)}</strong><span>per gal</span></td>
      <td data-label="Unit price"><strong>${money(row.price_per_unit, row.currency)}</strong><span>per unit</span></td>
      <td data-label="Action">${quote}</td>
    </tr>`;
}

function renderSegment(root, data) {
  const slug = root.dataset.segmentPricing;
  const segment = (data.segments || []).find((item) => item.slug === slug);
  if (!segment) {
    root.innerHTML = '<p class="muted">Pricing is unavailable.</p>';
    return;
  }
  root.innerHTML = `
    <div class="segment-pricing-head">
      <div>
        <span class="catalog-label">Segment pricing</span>
        <h2 class="headline">${escapeHtml(segment.title)}</h2>
        <p class="subhead">${escapeHtml(segment.intro)}</p>
      </div>
      <div class="segment-pricing-note">
        <b>${escapeHtml(data.volume_discount)}</b>
        <span>${escapeHtml(data.footer_note)}</span>
      </div>
    </div>
    <div class="segment-pricing-scroll">
      <table class="segment-pricing-table">
        <caption class="sr-only">${escapeHtml(segment.title)} — price per product, pack, and how to buy or request a quote</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Application</th>
            <th scope="col">Pack</th>
            <th scope="col">Price / gal</th>
            <th scope="col">Unit price</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>${segment.rows.map(rowMarkup).join("")}</tbody>
      </table>
    </div>`;
}

export async function initSegmentPricing(root = document) {
  const mount = root.querySelector("[data-segment-pricing]");
  if (!mount) return;
  try {
    const response = await fetch("data/segment-pricing.json", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("segment_pricing_unavailable");
    const data = await response.json();
    const pricing = await loadPricingData();
    const liveBySku = new Map((pricing.variants || []).map((variant) => [variant.vsku, variant]));
    data.segments = (data.segments || []).map((segment) => ({
      ...segment,
      rows: (segment.rows || []).flatMap((row) => {
        const variant = liveBySku.get(row.sku);
        const price = variant?.tiers?.hvac;
        if (price == null) return [];
        return [{
          ...row,
          currency: pricing.currency || "usd",
          price_per_unit: Number(price),
          price_per_gallon: Number(price) / Number(variant.gallons || row.size_gal || 1),
        }];
      }),
    }));
    renderSegment(mount, data);
  } catch {
    mount.innerHTML = '<p class="muted">Pricing is unavailable.</p>';
  }
}

initSegmentPricing();
import { loadPricingData } from "./pricing-data.js?v=20260807g";

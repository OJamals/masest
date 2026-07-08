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
  const quote = row.quote_only
    ? `<a class="btn btn-secondary btn-sm" href="contact?type=quote&amp;sku=${encodeURIComponent(row.sku)}">Request quote</a>`
    : `<a class="segment-buyable" href="${productPath(row)}">Buy small pack</a>`;
  return `
    <tr data-segment-pricing-row>
      <td><b>${escapeHtml(row.product)}</b><span>${escapeHtml(row.sku)}</span></td>
      <td>${escapeHtml(row.application)}</td>
      <td>${escapeHtml(row.pack)}</td>
      <td><strong>${money(row.price_per_gallon, row.currency)}</strong><span>per gal</span></td>
      <td><strong>${money(row.price_per_unit, row.currency)}</strong><span>per unit</span></td>
      <td>${quote}</td>
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
        <thead>
          <tr>
            <th>Product</th>
            <th>Application</th>
            <th>Pack</th>
            <th>Price / gal</th>
            <th>Unit price</th>
            <th>Action</th>
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
    renderSegment(mount, await response.json());
  } catch {
    mount.innerHTML = '<p class="muted">Pricing is unavailable.</p>';
  }
}

initSegmentPricing();

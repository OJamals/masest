let pricingRequest;

export function loadPricingData() {
  if (!pricingRequest) {
    pricingRequest = fetch("/api/pricing", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then((response) => {
      if (!response.ok) throw new Error(`pricing_unavailable:${response.status}`);
      return response.json();
    }).catch((error) => {
      pricingRequest = null;
      throw error;
    });
  }
  return pricingRequest;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function variantMap(data) {
  return new Map((data?.variants || []).map((variant) => [variant.vsku, variant]));
}

function renderVariantPrice(binding, variants) {
  const scope = binding.closest("[data-price-vsku]") || binding;
  const variant = variants.get(scope.dataset.priceVsku || binding.dataset.priceVsku);
  const tier = binding.dataset.priceTier || scope.dataset.priceTier || "retail";
  const price = variant?.tiers?.[tier];
  if (price == null) return;
  const field = binding.dataset.priceField || "unit";
  if (field === "per_gallon") {
    const gallons = Number(variant.gallons);
    if (!(gallons > 0)) return;
    binding.textContent = `${money(Number(price) / gallons)}/gal`;
    return;
  }
  binding.textContent = money(price);
}

export function applyPricingBindings(root, data) {
  const variants = variantMap(data);
  const seen = new Set();
  root.querySelectorAll("[data-price-vsku]").forEach((scope) => {
    const bindings = scope.matches("[data-price-field]")
      ? [scope]
      : Array.from(scope.querySelectorAll("[data-price-field]"));
    for (const binding of bindings) {
      if (seen.has(binding)) continue;
      seen.add(binding);
      renderVariantPrice(binding, variants);
    }
  });
  return seen.size;
}

function renderVariantPriceTable(mount, variants) {
  const tier = mount.dataset.priceTier || "retail";
  const wanted = new Set(String(mount.dataset.priceVskus || "").split(",").map((vsku) => vsku.trim()).filter(Boolean));
  const rows = (variants || []).filter((variant) => wanted.has(variant.vsku) && variant.tiers?.[tier] != null);
  mount.innerHTML = `<table class="cmp-table">
    <thead><tr><th scope="col">Product</th><th scope="col">Pack</th><th scope="col">Public price / gal</th><th scope="col">Public pack price</th></tr></thead>
    <tbody>${rows.map((variant) => {
      const unit = Number(variant.tiers[tier]);
      const perGallon = Number(variant.gallons) > 0 ? unit / Number(variant.gallons) : unit;
      return `<tr>
        <td class="job">${escapeHtml(variant.product_name)}</td>
        <td>${escapeHtml(variant.label)}</td>
        <td>${money(perGallon)}/gal</td>
        <td>${money(unit)}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

export async function initPricingBindings(root = document) {
  const bindings = root.querySelector("[data-price-vsku]");
  const tables = Array.from(root.querySelectorAll("[data-variant-price-table]"));
  if (!bindings && !tables.length) return 0;
  try {
    const data = await loadPricingData();
    const count = applyPricingBindings(root, data);
    tables.forEach((mount) => renderVariantPriceTable(mount, data.variants));
    return count + tables.length;
  } catch {
    return 0;
  }
}

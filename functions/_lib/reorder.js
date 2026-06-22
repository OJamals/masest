// Re-price a past order's line items into a "buy again" cart (#19).
// variantsBySku: { [vsku]: { price, active } } from product_variants.
// Drops items whose variant is gone / inactive / unpriced; flags price changes.
// Pricing here is for display — checkout re-prices authoritatively.
export function repriceCart(items, variantsBySku = {}) {
  const lines = [];
  const issues = [];
  for (const it of items || []) {
    const sku = it.sku;
    if (!sku) continue;
    const v = variantsBySku[sku];
    if (!v || v.active === false || v.price == null) {
      issues.push({ sku, name: it.name, reason: 'unavailable' });
      continue;
    }
    const unit_price = Number(v.price);
    const was = Number(it.unit_price);
    if (Number.isFinite(was) && was !== unit_price) {
      issues.push({ sku, name: it.name, reason: 'price_changed', was, now: unit_price });
    }
    lines.push({ sku, name: it.name, qty: Number(it.qty) || 1, unit_price });
  }
  return { lines, issues };
}

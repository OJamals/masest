export function normalizeCartQty(value, max = Number.MAX_SAFE_INTEGER) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.min(Math.floor(qty), max);
}

export function normalizeCartLines(items, {
  normalizeSku = (value) => String(value || "").trim(),
  maxQty = Number.MAX_SAFE_INTEGER,
  merge = true,
  sort = true,
} = {}) {
  if (!Array.isArray(items)) return [];
  const normalized = new Map();
  for (const item of items) {
    const sku = normalizeSku(item?.sku);
    const qty = normalizeCartQty(item?.qty, maxQty);
    if (!sku || !qty) continue;
    if (!merge && normalized.has(sku)) return [];
    normalized.set(
      sku,
      merge ? Math.min((normalized.get(sku) || 0) + qty, maxQty) : qty,
    );
  }
  const lines = [...normalized].map(([sku, qty]) => ({ sku, qty }));
  return sort ? lines.sort((a, b) => a.sku.localeCompare(b.sku)) : lines;
}

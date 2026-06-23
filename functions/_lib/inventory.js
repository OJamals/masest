// Pure inventory CSV parsing for bulk stock import (#98). No I/O — unit-tested.
// Accepts "vsku,stock" lines (one variant per line). A leading header row whose
// second column isn't a number is skipped. Blank lines ignored. Each row's stock
// must be a non-negative integer; bad rows are collected as errors, not thrown.
export function parseInventoryRows(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const vsku = cols[0];
    const stockRaw = cols[1];
    // Skip an obvious header row (e.g. "vsku,stock") only when it's the first line.
    if (i === 0 && stockRaw !== undefined && !/^-?\d+$/.test(stockRaw)) return;
    if (!vsku) { errors.push({ line: i + 1, reason: "missing_vsku" }); return; }
    const stock = Number(stockRaw);
    if (stockRaw === undefined || stockRaw === "" || !Number.isInteger(stock) || stock < 0) {
      errors.push({ line: i + 1, reason: "invalid_stock", vsku });
      return;
    }
    rows.push({ vsku, stock });
  });
  return { rows, errors };
}

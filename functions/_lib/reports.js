// Pure CSV + revenue/tax aggregation for admin reporting & exports (#96).
// toCsv/revenueReport/parseRange are pure (unit-tested); csvResponse wraps the Web Response.

// RFC-4180-ish: quote every field, double embedded quotes, CRLF rows.
export function toCsv(rows) {
  return (rows || [])
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

export function csvResponse(rows, filename) {
  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

// Orders that represent collected revenue.
const PAID_STATUSES = ["paid", "net_paid", "fulfilled"];

// Aggregate an (already date-filtered) order set into a revenue/tax summary.
export function revenueReport(orders) {
  const list = orders || [];
  const paid = list.filter((o) => PAID_STATUSES.includes(o.status));
  const revenue = +paid.reduce((s, o) => s + Number(o.total || 0), 0).toFixed(2);
  const tax = +paid.reduce((s, o) => s + Number(o.tax || 0), 0).toFixed(2);
  const by_status = {};
  const by_payment = {};
  for (const o of list) {
    by_status[o.status] = (by_status[o.status] || 0) + 1;
    const pm = o.payment_method || "unknown";
    by_payment[pm] = (by_payment[pm] || 0) + 1;
  }
  return {
    orders: list.length,
    paid_orders: paid.length,
    revenue,
    tax,
    average_order_value: paid.length ? +(revenue / paid.length).toFixed(2) : 0,
    by_status,
    by_payment,
  };
}

// Parse a date-range query → ISO bounds (null when absent/invalid). A bare YYYY-MM-DD
// `to` is treated as inclusive of the whole day (pushed to 23:59:59.999Z).
export function parseRange(from, to) {
  const f = from ? new Date(from) : null;
  const fromIso = f && !Number.isNaN(f.getTime()) ? f.toISOString() : null;

  let toIso = null;
  if (to) {
    const t = new Date(to);
    if (!Number.isNaN(t.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) t.setUTCHours(23, 59, 59, 999);
      toIso = t.toISOString();
    }
  }
  return { fromIso, toIso };
}

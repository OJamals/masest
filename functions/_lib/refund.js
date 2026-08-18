// Pure refund math for admin partial refunds (#22).
// All amounts are in dollars (orders.total / orders.refunded_amount are numeric(12,2)).
// `requestedAmount` is optional — omit it to refund the full remaining balance.
//
// Returns { ok:false, error } on a bad request, otherwise:
//   { ok:true, amount, amountCents, newRefundedAmount, fullyRefunded }
// where amountCents is what to hand Stripe and fullyRefunded gates the 'refunded'
// status flip + stock re-increment.

const round2 = (n) => Math.round(n * 100) / 100;

export function computeRefund({ total, refundedAmount = 0, requestedAmount } = {}) {
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return { ok: false, error: 'invalid_total' };

  const already = Number(refundedAmount) || 0;
  const remaining = round2(totalNum - already);
  if (remaining <= 0) return { ok: false, error: 'already_refunded' };

  let amount;
  if (requestedAmount === undefined || requestedAmount === null || requestedAmount === '') {
    amount = remaining; // default: refund the whole remaining balance
  } else {
    amount = round2(Number(requestedAmount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid_amount' };
    if (amount > remaining) return { ok: false, error: 'amount_exceeds_remaining' };
  }

  const newRefundedAmount = round2(already + amount);
  const fullyRefunded = newRefundedAmount + 1e-9 >= totalNum;

  return { ok: true, amount, amountCents: Math.round(amount * 100), newRefundedAmount, fullyRefunded };
}

// Line-level refunds: staff pick SKUs and quantities, the amount follows from the order's
// own line prices. Deriving it here (rather than trusting a number from the browser) keeps
// the refunded amount and the restocked quantities describing the same event.
export function computeLineRefund({ orderItems = [], lines = [], refundedLines = [] } = {}) {
  if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'refund_lines_required' };
  const available = new Map();
  for (const item of orderItems) {
    const sku = String(item?.sku || '').trim();
    const qty = Math.floor(Number(item?.qty) || 0);
    if (!sku || qty <= 0) continue;
    const unitPrice = Number(item?.unit_price) || 0;
    const existing = available.get(sku);
    // Duplicate SKUs on one order sum their quantity but must share a single unit price.
    if (existing) {
      existing.qty += qty;
      existing.restockQty += item?.backordered ? 0 : qty;
      if (Math.abs(existing.unitPrice - unitPrice) > 0.000001) existing.ambiguousPrice = true;
    } else {
      available.set(sku, {
        qty,
        unitPrice,
        restockQty: item?.backordered ? 0 : qty,
        ambiguousPrice: false,
      });
    }
  }

  // Completed and already-claimed line reversals consume refundable quantity. This is
  // separate from `refunded_amount`: an amount-only refund has no defensible SKU mapping.
  for (const line of Array.isArray(refundedLines) ? refundedLines : []) {
    const sku = String(line?.sku || '').trim();
    const qty = Math.floor(Number(line?.qty) || 0);
    const source = available.get(sku);
    if (!source || qty <= 0) continue;
    source.qty = Math.max(0, source.qty - qty);
    const restored = Number.isFinite(Number(line?.restock_qty))
      ? Math.floor(Number(line.restock_qty))
      : qty;
    source.restockQty = Math.max(0, source.restockQty - Math.max(0, restored));
  }

  const seen = new Set();
  const selected = [];
  let amount = 0;
  for (const line of lines) {
    const sku = String(line?.sku || '').trim();
    const qty = Math.floor(Number(line?.qty) || 0);
    const source = available.get(sku);
    if (!sku || seen.has(sku)) return { ok: false, error: 'refund_lines_invalid' };
    if (!source || source.ambiguousPrice || qty <= 0 || qty > source.qty) {
      return { ok: false, error: 'refund_lines_invalid' };
    }
    seen.add(sku);
    const lineTotal = Math.round(source.unitPrice * qty * 100) / 100;
    amount = Math.round((amount + lineTotal) * 100) / 100;
    const restockQty = Math.min(qty, source.restockQty);
    selected.push({
      sku,
      qty,
      unit_price: source.unitPrice,
      line_total: lineTotal,
      restock_qty: restockQty,
      backordered: restockQty === 0,
    });
  }
  if (amount <= 0) return { ok: false, error: 'refund_lines_invalid' };
  return { ok: true, amount, lines: selected };
}

export function qboFullDocumentRefund({ total, refundedAmount = 0, amount = 0 } = {}) {
  const totalNum = round2(Number(total) || 0);
  const already = round2(Number(refundedAmount) || 0);
  const refundAmount = round2(Number(amount) || 0);
  return totalNum > 0 && already <= 0 && refundAmount + 1e-9 >= totalNum;
}

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

// Shared B2B credit logic — single source of truth for a company's open NET balance and
// available credit. Used by checkout.js (enforcement) and account/me.js (display).
//
// Outstanding = sum of order totals still owed on account (status 'net_open').
//   'net_paid' = settled (excluded); every other status is not NET-owed (excluded).
// credit_limit semantics:
//   null  -> unlimited (no enforcement; preserves pre-enforcement behavior)
//   0     -> zero credit (every NET order blocks)
//   > 0   -> enforced ceiling

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Pure predicate: would an order of `orderTotal` push the company over its limit?
// At-limit (==) is allowed; strictly over (>) is blocked.
export function exceedsCredit(state, orderTotal) {
  if (state.unlimited) return false;
  return round2(state.outstanding + Number(orderTotal || 0)) > state.credit_limit;
}

// Reads the company's open NET balance and derives available credit.
// `creditLimit` is companies.credit_limit (caller already loaded the company row).
// Throws on query error so the caller chooses how to fail (checkout -> 503; me -> degrade).
export async function companyCreditState(sb, companyId, creditLimit) {
  const unlimited = creditLimit == null;
  const { data, error } = await sb
    .from('orders')
    .select('total')
    .eq('company_id', companyId)
    .eq('status', 'net_open');
  if (error) throw error;
  const outstanding = round2((data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0));
  const credit_limit = unlimited ? null : Number(creditLimit);
  const available = unlimited ? null : Math.max(0, round2(credit_limit - outstanding));
  return { credit_limit, outstanding, available, unlimited };
}

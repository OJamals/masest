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

// True when a Supabase RPC failed because the function isn't deployed yet — Postgres
// undefined_function (42883) or PostgREST's "function not found" (PGRST202). Lets
// checkout.js prefer the atomic place_net_order RPC but fall back to the in-app credit
// check when the migration hasn't been applied, so NET checkout never hard-breaks.
export function isMissingFunctionError(error) {
  return error?.code === '42883' || error?.code === 'PGRST202';
}

// Pure predicate: would an order of `orderTotal` push the company over its limit?
// At-limit (==) is allowed; strictly over (>) is blocked.
export function exceedsCredit(state, orderTotal) {
  if (state.unlimited) return false;
  return round2(state.outstanding + Number(orderTotal || 0)) > state.credit_limit;
}

// Pure NET-settlement planner for the manual (non-QBO) "mark NET paid" affordance.
// Only a NET order in the net_open state may be settled, so staff cannot accidentally
// flip a cart / card-paid / cancelled order to net_paid. Unlike record_qbo_payment this
// needs no QuickBooks payment id; the optional free-text reference (check/wire no.) is
// returned for the audit trail only — there is no settlement-reference column.
export function planNetSettlement(order, { reference } = {}) {
  if (!order) return { ok: false, error: 'not_found' };
  if (order.payment_method !== 'net') return { ok: false, error: 'not_net' };
  if (order.status === 'net_paid') return { ok: false, error: 'already_settled' };
  if (order.status !== 'net_open') return { ok: false, error: 'not_open' };
  const ref = String(reference || '').trim().slice(0, 200) || null;
  return { ok: true, update: { status: 'net_paid' }, reference: ref };
}

// NET aging for an admin order view (#10 residual). Returns null unless the order
// is an OPEN net balance — only those carry outstanding risk. termsDays =
// company.net_terms_days (0 = no terms, so no meaningful due date → never overdue).
// nowMs lets tests pin "now"; defaults to Date.now().
export function netAging(order, termsDays, nowMs) {
  if (!order || order.payment_method !== 'net' || order.status !== 'net_open') return null;
  const created = Date.parse(order.created_at);
  if (Number.isNaN(created)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const DAY = 86400000;
  const terms = Math.max(0, Math.floor(Number(termsDays) || 0));
  const ageDays = Math.max(0, Math.floor((now - created) / DAY));
  const dueMs = created + terms * DAY;
  const overdue = terms > 0 && now > dueMs;
  const daysOverdue = overdue ? Math.max(0, Math.floor((now - dueMs) / DAY)) : 0;
  const bucket = !overdue ? 'current'
    : daysOverdue <= 30 ? 'over30'
    : daysOverdue <= 60 ? 'over60'
    : 'over90';
  return { ageDays, terms, dueIso: new Date(dueMs).toISOString(), overdue, daysOverdue, bucket };
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

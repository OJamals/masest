import { stripeCredentialMode } from './stripe-runtime.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const DEFAULT_PAYOUT_LIMIT = 3;
const MAX_PAYOUT_LIMIT = 5;
const MAX_TRANSACTION_PAGES = 5;
const TRANSACTION_PAGE_LIMIT = 100;
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

const QBO_MAPPING_FIELDS = Object.freeze({
  products_income: 'QBO_INCOME_ACCOUNT_ID',
  shipping_income: 'QBO_SHIPPING_INCOME_ACCOUNT_ID',
  merchant_fees: 'QBO_MERCHANT_FEES_ACCOUNT_ID',
  postage_expense: 'QBO_POSTAGE_EXPENSE_ACCOUNT_ID',
  stripe_clearing: 'QBO_STRIPE_CLEARING_ACCOUNT_ID',
  bank: 'QBO_BANK_ACCOUNT_ID',
  tax: 'QBO_TAX_LIABILITY_ACCOUNT_ID',
  discounts: 'QBO_DISCOUNTS_ACCOUNT_ID',
  refunds: 'QBO_REFUNDS_ACCOUNT_ID',
  disputes: 'QBO_DISPUTES_ACCOUNT_ID',
});

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAYOUT_LIMIT;
  return Math.min(MAX_PAYOUT_LIMIT, Math.max(1, parsed));
}

function minor(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new StripePayoutError('stripe_payout_response_invalid', 502);
  }
  return value;
}

function addMinor(total, value) {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new StripePayoutError('stripe_payout_response_invalid', 502);
  return next;
}

function unixIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function traceId(value) {
  if (typeof value === 'string') return text(value, 120) || null;
  return text(value?.value, 120) || null;
}

export class StripePayoutError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'StripePayoutError';
    this.code = code;
    this.status = status;
  }
}

export function stripeCurrencyExponent(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(text(currency, 8).toLowerCase()) ? 0 : 2;
}

export function qboStripeMappingStatus(env = {}) {
  const mappings = {};
  const missing = [];
  for (const [name, key] of Object.entries(QBO_MAPPING_FIELDS)) {
    const present = Boolean(text(env[key]));
    mappings[name] = present ? 'present' : 'missing';
    if (!present) missing.push(key);
  }
  return {
    posting_ready: missing.length === 0,
    mappings,
    missing,
    required: Object.values(QBO_MAPPING_FIELDS),
  };
}

export function summarizeStripeBalanceTransactions(transactions = [], expectedCurrency = '') {
  const expected = text(expectedCurrency, 8).toLowerCase();
  const categories = new Map();
  let grossInflow = 0;
  let grossOutflow = 0;
  let fees = 0;
  let net = 0;
  let transactionCount = 0;
  let multiCurrency = false;

  for (const transaction of transactions) {
    const currency = text(transaction?.currency, 8).toLowerCase();
    if (!currency || (expected && currency !== expected)) {
      multiCurrency = true;
      continue;
    }
    const amount = minor(transaction?.amount);
    const fee = minor(transaction?.fee);
    const transactionNet = minor(transaction?.net);
    const category = text(transaction?.reporting_category || transaction?.type || 'uncategorized', 80) || 'uncategorized';
    const row = categories.get(category) || {
      category,
      transaction_count: 0,
      amount_minor: 0,
      fee_minor: 0,
      net_minor: 0,
    };
    row.transaction_count += 1;
    row.amount_minor = addMinor(row.amount_minor, amount);
    row.fee_minor = addMinor(row.fee_minor, fee);
    row.net_minor = addMinor(row.net_minor, transactionNet);
    categories.set(category, row);
    transactionCount += 1;
    if (amount >= 0) grossInflow = addMinor(grossInflow, amount);
    else grossOutflow = addMinor(grossOutflow, amount);
    fees = addMinor(fees, fee);
    net = addMinor(net, transactionNet);
  }
  return {
    totals: {
      transaction_count: transactionCount,
      gross_inflow_minor: grossInflow,
      gross_outflow_minor: grossOutflow,
      fee_minor: fees,
      net_minor: net,
    },
    categories: [...categories.values()].sort((left, right) => left.category.localeCompare(right.category)),
    multi_currency: multiCurrency,
  };
}

async function defaultStripeRequest(env, path, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${STRIPE_API}${path}`, {
      headers: { Authorization: `Bearer ${text(env?.STRIPE_SECRET_KEY)}` },
    });
  } catch {
    throw new StripePayoutError('stripe_payouts_failed', 502);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new StripePayoutError('stripe_payouts_failed', 502);
  return payload;
}

async function loadPayoutTransactions(env, payoutId, request) {
  const transactions = new Map();
  let startingAfter = null;
  let providerTruncated = false;
  for (let page = 0; page < MAX_TRANSACTION_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(TRANSACTION_PAGE_LIMIT), payout: payoutId });
    if (startingAfter) params.set('starting_after', startingAfter);
    const payload = await request(env, `/balance_transactions?${params}`);
    if (!Array.isArray(payload?.data)) throw new StripePayoutError('stripe_payout_response_invalid', 502);
    const rows = payload.data.slice(0, TRANSACTION_PAGE_LIMIT);
    for (const row of rows) {
      const id = text(row?.id, 120);
      if (!/^txn_[A-Za-z0-9_]+$/.test(id) || transactions.has(id)) {
        throw new StripePayoutError('stripe_payout_response_invalid', 502);
      }
      minor(row?.amount);
      minor(row?.fee);
      minor(row?.net);
      if (!/^[a-z]{3}$/.test(text(row?.currency, 8).toLowerCase())) {
        throw new StripePayoutError('stripe_payout_response_invalid', 502);
      }
      transactions.set(id, row);
    }
    if (payload?.has_more !== true) return { transactions: [...transactions.values()], providerTruncated: false };
    const next = text(rows.at(-1)?.id, 120);
    if (!next || next === startingAfter) {
      providerTruncated = true;
      break;
    }
    startingAfter = next;
    if (page === MAX_TRANSACTION_PAGES - 1) providerTruncated = true;
  }
  return { transactions: [...transactions.values()], providerTruncated };
}

function safePayout(payout) {
  const id = text(payout?.id, 120);
  const currency = text(payout?.currency, 8).toLowerCase();
  if (!/^po_[A-Za-z0-9_]+$/.test(id) || !/^[a-z]{3}$/.test(currency)) {
    throw new StripePayoutError('stripe_payout_response_invalid', 502);
  }
  return {
    id,
    status: text(payout?.status, 40) || 'unknown',
    currency,
    currency_exponent: stripeCurrencyExponent(currency),
    amount_minor: minor(payout?.amount),
    arrival_at: unixIso(payout?.arrival_date),
    created_at: unixIso(payout?.created),
    automatic: payout?.automatic === true,
    method: text(payout?.method, 40) || null,
    type: text(payout?.type, 40) || null,
    trace_id: traceId(payout?.trace_id),
  };
}

export async function stripePayoutReconciliation(env = {}, options = {}, dependencies = {}) {
  if (stripeCredentialMode(env.STRIPE_SECRET_KEY) !== 'live') {
    throw new StripePayoutError('stripe_live_key_required', 400);
  }
  const limit = boundedLimit(options.limit);
  const request = dependencies.request || ((runtimeEnv, path) => defaultStripeRequest(runtimeEnv, path, dependencies));
  const list = await request(env, `/payouts?${new URLSearchParams({ limit: String(limit) })}`);
  if (!Array.isArray(list?.data)) throw new StripePayoutError('stripe_payout_response_invalid', 502);
  const providerPayouts = list.data.slice(0, limit);
  const payouts = [];
  for (const providerPayout of providerPayouts) {
    const payout = safePayout(providerPayout);
    const supported = payout.automatic && payout.method === 'standard';
    if (!supported) {
      payouts.push({
        ...payout,
        supported: false,
        unsupported_reason: 'manual_or_instant_payout',
        complete: false,
        provider_truncated: false,
        matches_payout: null,
        totals: null,
        categories: [],
      });
      continue;
    }
    const loaded = await loadPayoutTransactions(env, payout.id, request);
    const summary = summarizeStripeBalanceTransactions(loaded.transactions, payout.currency);
    const complete = !loaded.providerTruncated && !summary.multi_currency;
    payouts.push({
      ...payout,
      supported: !summary.multi_currency,
      unsupported_reason: summary.multi_currency ? 'multi_currency' : null,
      complete,
      provider_truncated: loaded.providerTruncated,
      multi_currency: summary.multi_currency,
      matches_payout: complete ? summary.totals.net_minor === payout.amount_minor : null,
      totals: summary.totals,
      categories: summary.categories,
    });
  }
  return {
    limit,
    payouts_has_more: list?.has_more === true,
    payouts,
  };
}

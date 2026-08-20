// Company store credit is a discretionary USD merchandise discount. It is separate
// from the Company's NET credit limit in credit.js. The database owns balances and
// reservation transitions; this module owns exact input/allocation and RPC contracts.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ADJUSTMENT_MINOR = 100_000_000;

function storeCreditError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function rpcErrorCode(error, fallback) {
  const detail = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  for (const code of [
    'store_credit_request_identity_collision',
    'store_credit_insufficient',
    'store_credit_reservation_conflict',
    'store_credit_reservation_not_found',
    'store_credit_reservation_expired',
    'store_credit_order_conflict',
    'invalid_store_credit_adjustment',
  ]) {
    if (detail.includes(code)) return code;
  }
  return fallback;
}

function rpcObject(result, fallback) {
  if (result?.error) throw storeCreditError(rpcErrorCode(result.error, fallback), result.error);
  if (!result?.data || typeof result.data !== 'object') throw storeCreditError(fallback);
  return result.data;
}

function productUnitMinor(product) {
  const minor = Math.round(Number(product?.price) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw storeCreditError('invalid_store_credit_merchandise');
  return minor;
}

export function normalizeStoreCreditAdjustment(value) {
  const raw = String(value ?? '').trim();
  const match = /^(-?)(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return { error: 'invalid_store_credit_adjustment' };
  const dollars = Number(match[2]);
  const cents = Number((match[3] || '').padEnd(2, '0'));
  const sign = match[1] ? -1 : 1;
  const minor = sign * ((dollars * 100) + cents);
  if (!Number.isSafeInteger(minor) || minor === 0 || Math.abs(minor) > MAX_ADJUSTMENT_MINOR) {
    return { error: 'invalid_store_credit_adjustment' };
  }
  return { value: minor };
}

export function normalizeStoreCreditIntentId(value) {
  const id = String(value || '').trim().toLowerCase();
  return UUID_RE.test(id) ? id : '';
}

export function allocateStoreCredit(sellable, qtyBySku, requestedAmountMinor) {
  const products = Array.isArray(sellable) ? sellable : [];
  const normalized = products.map((product) => {
    const quantity = Number(qtyBySku?.[product?.sku]);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw storeCreditError('invalid_store_credit_merchandise');
    }
    return { product, quantity, unitAmountMinor: productUnitMinor(product) };
  });
  const subtotalMinor = normalized.reduce(
    (sum, line) => sum + (line.quantity * line.unitAmountMinor),
    0,
  );
  if (!Number.isSafeInteger(subtotalMinor)) throw storeCreditError('invalid_store_credit_merchandise');

  const requested = Number(requestedAmountMinor);
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw storeCreditError('invalid_store_credit_amount');
  }
  const amountMinor = Math.min(requested, subtotalMinor);
  let remaining = amountMinor;
  const lines = [];

  for (const line of normalized) {
    const lineTotal = line.quantity * line.unitAmountMinor;
    const reduction = Math.min(remaining, lineTotal);
    remaining -= reduction;
    const perUnitReduction = Math.floor(reduction / line.quantity);
    const remainder = reduction % line.quantity;
    const lowerUnitAmount = line.unitAmountMinor - perUnitReduction - (remainder ? 1 : 0);
    const higherUnitAmount = line.unitAmountMinor - perUnitReduction;

    if (remainder) {
      lines.push({ product: line.product, quantity: remainder, unitAmountMinor: lowerUnitAmount });
    }
    if (line.quantity - remainder) {
      lines.push({
        product: line.product,
        quantity: line.quantity - remainder,
        unitAmountMinor: higherUnitAmount,
      });
    }
  }

  if (remaining !== 0 || lines.some((line) => line.unitAmountMinor < 0)) {
    throw storeCreditError('store_credit_allocation_failed');
  }
  return { subtotalMinor, amountMinor, lines };
}

export function storeCreditCheckoutIdempotencyKey(reservationId) {
  const id = String(reservationId || '').trim();
  if (!id) throw storeCreditError('store_credit_reservation_not_found');
  return `store-credit-checkout:${id}`;
}

export async function companyStoreCreditSummary(sb, companyId, currency = 'usd') {
  return rpcObject(await sb.rpc('company_store_credit_summary', {
    p_company_id: companyId,
    p_currency: String(currency || 'usd').toLowerCase(),
  }), 'store_credit_summary_failed');
}

export async function reserveCompanyStoreCredit(sb, {
  companyId,
  userId,
  intentId,
  maxAmountMinor,
  expiresAt,
  currency = 'usd',
}) {
  return rpcObject(await sb.rpc('reserve_company_store_credit', {
    p_company_id: companyId,
    p_user_id: userId,
    p_intent_id: normalizeStoreCreditIntentId(intentId),
    p_max_amount_minor: maxAmountMinor,
    p_expires_at: expiresAt,
    p_currency: String(currency || 'usd').toLowerCase(),
  }), 'store_credit_reservation_failed');
}

export async function attachCompanyStoreCreditReservation(sb, {
  reservationId,
  stripeSessionId,
}) {
  return rpcObject(await sb.rpc('attach_company_store_credit', {
    p_reservation_id: reservationId,
    p_stripe_session_id: stripeSessionId,
  }), 'store_credit_attach_failed');
}

export async function consumeCompanyStoreCredit(sb, {
  reservationId,
  stripeSessionId,
  orderId,
}) {
  return rpcObject(await sb.rpc('consume_company_store_credit', {
    p_reservation_id: reservationId,
    p_stripe_session_id: stripeSessionId,
    p_order_id: orderId,
  }), 'store_credit_consume_failed');
}

export async function releaseCompanyStoreCredit(sb, {
  reservationId,
  stripeSessionId = null,
}) {
  return rpcObject(await sb.rpc('release_company_store_credit', {
    p_reservation_id: reservationId,
    p_stripe_session_id: stripeSessionId,
  }), 'store_credit_release_failed');
}

export async function adjustCompanyStoreCredit(sb, {
  companyId,
  amountMinor,
  reason,
  requestId,
  actorUserId,
  currency = 'usd',
}) {
  return rpcObject(await sb.rpc('adjust_company_store_credit', {
    p_company_id: companyId,
    p_amount_minor: amountMinor,
    p_reason: String(reason || '').trim(),
    p_request_id: normalizeStoreCreditIntentId(requestId),
    p_actor_user_id: actorUserId,
    p_currency: String(currency || 'usd').toLowerCase(),
  }), 'store_credit_adjustment_failed');
}

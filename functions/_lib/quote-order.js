import { quotePayloadWithOffer } from './quote-convert.js';
import {
  offerExpiryReached,
  offerStatus,
  offerValidityExpired,
  quoteExpirationPatch,
  quoteIsOpenRequisition,
} from './quote-lifecycle.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requisitionQuoteMayBeSent(quote = {}, now = Date.now()) {
  if (quote?.source && quote.source !== 'requisition') return false;
  const storedOffer = offerStatus(quote);
  if (quote.status === 'spam' || quote.pipeline_stage === 'won') return false;
  if (['accepted', 'payment_pending', 'ordered'].includes(storedOffer)) return false;
  // Sending a revision is the explicit reactivation policy for a declined/expired
  // requisition. The atomic offer commit reopens status/pipeline, and the unique index
  // rejects it if the Buyer already created a fresh open request for this requisition.
  if (['declined', 'expired'].includes(storedOffer)) return true;
  if (quote.status === 'closed' || quote.pipeline_stage === 'lost') return false;
  return !['accepted', 'payment_pending', 'ordered'].includes(
    offerExpiryReached(quote, now) ? 'expired' : quote.payload?.offer_status,
  );
}

export function guardQuoteOffer(query, payload = {}) {
  const orderId = String(payload?.offer_order_id || '');
  const status = String(payload?.offer_status || '');
  const orderGuard = orderId
    ? query.contains('payload', { offer_order_id: orderId })
    : query.is('payload->>offer_order_id', null);
  return status
    ? orderGuard.contains('payload', { offer_status: status })
    : orderGuard.is('payload->>offer_status', null);
}

export function isOpenRequisitionQuoteConflict(error) {
  const detail = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return error?.code === '23505' && detail.includes('quotes_open_requisition_unique_idx');
}

export async function findOpenRequisitionQuote(sb, requisitionId) {
  const { data: quote, error } = await sb.from('quotes')
    .select('id,status,pipeline_stage,payload,source,created_at')
    .eq('source', 'requisition')
    .contains('payload', { requisition_id: requisitionId })
    .not('status', 'in', '(closed,spam)')
    // Historical requisitions can predate the pipeline default. Null is the same open
    // intake state used by quoteLifecycle(), so the storage lookup must retain it.
    .or('pipeline_stage.is.null,pipeline_stage.not.in.(lost,won)')
    .or('payload->>offer_status.is.null,payload->>offer_status.not.in.(declined,expired,ordered)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const open = quote && quoteIsOpenRequisition(quote);
  return {
    quote: open ? quote : null,
    // A time-expired/malformed sent row still participates in the database partial
    // unique index until its explicit expiry transition is persisted. Request creation
    // uses this snapshot to release that identity before inserting a fresh Quote.
    staleQuote: quote && !open ? quote : null,
    error,
  };
}

export async function expireQuoteOfferIfDue(sb, quote, {
  at = new Date().toISOString(),
} = {}) {
  const boundary = Date.parse(at);
  if (!offerExpiryReached(quote, boundary)) return { quote, expired: false };
  const patch = quoteExpirationPatch(quote, at);
  let update = sb.from('quotes').update(patch).eq('id', quote.id).eq('status', quote.status);
  update = quote.pipeline_stage == null
    ? update.is('pipeline_stage', null)
    : update.eq('pipeline_stage', quote.pipeline_stage);
  const query = guardQuoteOffer(update, quote.payload);
  const { data, error } = await query
    .select('id,created_at,type,product,industry,email,status,pipeline_stage,source,payload')
    .maybeSingle();
  if (error) return { quote, expired: true, error };
  if (data) return { quote: data, expired: true };

  const current = await sb.from('quotes')
    .select('id,created_at,type,product,industry,email,status,pipeline_stage,source,payload')
    .eq('id', quote.id)
    .maybeSingle();
  return {
    quote: current.data || quote,
    expired: true,
    ...(current.error ? { error: current.error } : {}),
  };
}

async function boundQuote(sb, quoteId, draftOrderId) {
  if (![quoteId, draftOrderId].every((id) => UUID.test(String(id || '')))) {
    return { error: 'invalid_quote_order_identity' };
  }
  const { data: quote, error } = await sb.from('quotes')
    .select('id,payload')
    .eq('id', quoteId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!quote || quote.payload?.offer_order_id !== draftOrderId) {
    return { error: 'quote_order_mismatch' };
  }
  return { quote };
}

function quoteOrderIdentity(quote, finalOrderId) {
  const currentFinalOrderId = quote.payload?.final_order_id;
  if ((quote.payload?.offer_status === 'ordered' || currentFinalOrderId)
    && currentFinalOrderId !== finalOrderId) {
    return { error: 'quote_final_order_mismatch' };
  }
  return quote.payload?.offer_status === 'ordered' ? { ok: true } : null;
}

function quotePaymentIsPending(quote, finalOrderId) {
  return quote.payload?.offer_status === 'payment_pending'
    && quote.payload?.final_order_id === finalOrderId;
}

function quoteIsAccepted(quote) {
  return quote.payload?.offer_status === 'accepted'
    && !quote.payload?.final_order_id;
}

async function updateQuoteState(sb, quote, patch) {
  let query = guardQuoteOffer(
    sb.from('quotes').update(patch).eq('id', quote.id),
    quote.payload,
  );
  const finalOrderId = String(quote.payload?.final_order_id || '');
  query = finalOrderId
    ? query.contains('payload', { final_order_id: finalOrderId })
    : query.is('payload->>final_order_id', null);
  const { data, error } = await query.select('id,payload').maybeSingle();
  return error ? { error: error.message } : { quote: data || null };
}

async function resolveQuoteUpdate(
  sb,
  { quoteId, draftOrderId, finalOrderId },
  updated,
  reachedState = () => false,
) {
  if (updated.error) return updated;
  if (updated.quote) return { ok: true };
  const current = await boundQuote(sb, quoteId, draftOrderId);
  if (current.error) return current;
  return quoteOrderIdentity(current.quote, finalOrderId)
    || (reachedState(current.quote) ? { ok: true } : { error: 'quote_state_conflict' });
}

export async function markQuotePaymentPending(sb, {
  quoteId,
  draftOrderId,
  finalOrderId,
  at = new Date().toISOString(),
}) {
  if (!UUID.test(String(finalOrderId || ''))) return { error: 'invalid_quote_order_identity' };
  const bound = await boundQuote(sb, quoteId, draftOrderId);
  if (bound.error) return bound;
  const identity = quoteOrderIdentity(bound.quote, finalOrderId);
  if (identity) return identity;
  if (quotePaymentIsPending(bound.quote, finalOrderId)) return { ok: true };
  const payload = quotePayloadWithOffer(bound.quote.payload, {
    orderId: draftOrderId,
    status: 'payment_pending',
    at,
    finalOrderId,
  });
  const updated = await updateQuoteState(sb, bound.quote, {
    payload,
    status: 'contacted',
    pipeline_stage: 'proposal',
    handled_at: at,
    next_step: 'Awaiting bank payment settlement',
  });
  return resolveQuoteUpdate(
    sb,
    { quoteId, draftOrderId, finalOrderId },
    updated,
    (quote) => quotePaymentIsPending(quote, finalOrderId),
  );
}

export async function reopenQuoteAfterPaymentFailure(sb, {
  quoteId,
  draftOrderId,
  finalOrderId,
  at = new Date().toISOString(),
}) {
  const bound = await boundQuote(sb, quoteId, draftOrderId);
  if (bound.error) return bound;
  const identity = quoteOrderIdentity(bound.quote, finalOrderId);
  if (identity) return identity;
  if (offerValidityExpired(bound.quote, Date.parse(at))) {
    const updated = await updateQuoteState(
      sb,
      bound.quote,
      quoteExpirationPatch(bound.quote, at),
    );
    return resolveQuoteUpdate(
      sb,
      { quoteId, draftOrderId, finalOrderId },
      updated,
      (quote) => quote.payload?.offer_status === 'expired',
    );
  }
  if (quoteIsAccepted(bound.quote)) return { ok: true };
  if (bound.quote.payload?.offer_status !== 'payment_pending') {
    return { error: 'quote_state_conflict' };
  }
  const payload = {
    ...bound.quote.payload,
    offer_status: 'accepted',
    offer_payment_failed_at: at,
  };
  delete payload.final_order_id;
  const updated = await updateQuoteState(sb, bound.quote, {
    payload,
    status: 'contacted',
    pipeline_stage: 'proposal',
    handled_at: at,
    next_step: 'Payment failed; buyer can retry checkout',
  });
  return resolveQuoteUpdate(
    sb,
    { quoteId, draftOrderId, finalOrderId },
    updated,
    quoteIsAccepted,
  );
}

export async function finalizeQuoteOrder(sb, {
  quoteId,
  draftOrderId,
  finalOrderId,
  at = new Date().toISOString(),
}) {
  if (!UUID.test(String(finalOrderId || ''))) return { error: 'invalid_quote_order_identity' };
  const bound = await boundQuote(sb, quoteId, draftOrderId);
  if (bound.error) return bound;
  const quote = bound.quote;
  const identity = quoteOrderIdentity(quote, finalOrderId);
  if (identity?.error) return identity;

  if (!identity?.ok) {
    const payload = quotePayloadWithOffer(quote.payload, {
      orderId: draftOrderId,
      status: 'ordered',
      at,
      finalOrderId,
    });
    const updated = await updateQuoteState(sb, quote, {
      payload,
      status: 'closed',
      pipeline_stage: 'won',
      stage_changed_at: at,
      handled_at: at,
      next_step: 'Order placed',
      due_at: null,
    });
    const resolved = await resolveQuoteUpdate(
      sb,
      { quoteId, draftOrderId, finalOrderId },
      updated,
    );
    if (resolved.error) return resolved;
  }

  if (draftOrderId !== finalOrderId) {
    const { error: deleteError } = await sb.from('orders').delete()
      .eq('id', draftOrderId)
      .eq('status', 'cart')
      .is('requisition_name', null);
    if (deleteError) return { error: deleteError.message };
  }
  return { ok: true };
}

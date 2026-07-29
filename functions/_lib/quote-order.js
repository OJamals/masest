import { quotePayloadWithOffer } from './quote-convert.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requisitionQuoteMayBeSent(quote = {}) {
  return !['closed', 'spam'].includes(quote.status)
    && !['accepted', 'payment_pending', 'ordered'].includes(quote.payload?.offer_status);
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
    .select('id,status,pipeline_stage,created_at')
    .eq('source', 'requisition')
    .contains('payload', { requisition_id: requisitionId })
    .not('status', 'in', '(closed,spam)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { quote: quote || null, error };
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

export async function markQuotePaymentPending(sb, {
  quoteId,
  draftOrderId,
  finalOrderId,
  at = new Date().toISOString(),
}) {
  if (!UUID.test(String(finalOrderId || ''))) return { error: 'invalid_quote_order_identity' };
  const bound = await boundQuote(sb, quoteId, draftOrderId);
  if (bound.error) return bound;
  if (bound.quote.payload?.offer_status === 'ordered') return { ok: true };
  if (bound.quote.payload?.final_order_id
    && bound.quote.payload.final_order_id !== finalOrderId) {
    return { error: 'quote_final_order_mismatch' };
  }
  const payload = quotePayloadWithOffer(bound.quote.payload, {
    orderId: draftOrderId,
    status: 'payment_pending',
    at,
    finalOrderId,
  });
  const { error } = await sb.from('quotes').update({
    payload,
    status: 'contacted',
    pipeline_stage: 'proposal',
    handled_at: at,
    next_step: 'Awaiting bank payment settlement',
  }).eq('id', quoteId);
  return error ? { error: error.message } : { ok: true };
}

export async function reopenQuoteAfterPaymentFailure(sb, {
  quoteId,
  draftOrderId,
  finalOrderId,
  at = new Date().toISOString(),
}) {
  const bound = await boundQuote(sb, quoteId, draftOrderId);
  if (bound.error) return bound;
  if (bound.quote.payload?.offer_status === 'ordered') return { ok: true };
  if (bound.quote.payload?.final_order_id
    && bound.quote.payload.final_order_id !== finalOrderId) {
    return { error: 'quote_final_order_mismatch' };
  }
  const payload = {
    ...bound.quote.payload,
    offer_status: 'accepted',
    offer_payment_failed_at: at,
  };
  delete payload.final_order_id;
  const { error } = await sb.from('quotes').update({
    payload,
    status: 'contacted',
    pipeline_stage: 'proposal',
    handled_at: at,
    next_step: 'Payment failed; buyer can retry checkout',
  }).eq('id', quoteId);
  return error ? { error: error.message } : { ok: true };
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
  if (quote.payload?.offer_status === 'ordered'
    && quote.payload?.final_order_id !== finalOrderId) {
    return { error: 'quote_final_order_mismatch' };
  }

  if (quote.payload?.offer_status !== 'ordered' || quote.payload?.final_order_id !== finalOrderId) {
    const payload = quotePayloadWithOffer(quote.payload, {
      orderId: draftOrderId,
      status: 'ordered',
      at,
      finalOrderId,
    });
    const { error: updateError } = await sb.from('quotes').update({
      payload,
      status: 'closed',
      pipeline_stage: 'won',
      stage_changed_at: at,
      handled_at: at,
      next_step: 'Order placed',
      due_at: null,
    }).eq('id', quoteId);
    if (updateError) return { error: updateError.message };
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

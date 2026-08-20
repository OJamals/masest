import {
  buildConvertItems,
  quoteOrderRow,
  quotePayloadWithOffer,
} from './quote-convert.js';
import {
  createSupabaseQuoteCheckoutAttemptStore,
  prepareQuoteCheckoutMutation,
  QuoteCheckoutAttemptError,
  releaseQuoteCheckoutMutation,
} from './quote-checkout-attempt.js';
import { quoteOfferEffects, toIntegrationEffectRows } from './integration-effects.js';
import {
  canTransitionOffer,
  offerExpiryReached,
  quoteBuyerActions,
  quoteBuyerOwns,
  quoteExpirationPatch,
} from './quote-lifecycle.js';
import { guardQuoteOffer, requisitionQuoteMayBeSent } from './quote-order.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function offerExpiry(value, now) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp > now.getTime()
    ? new Date(timestamp).toISOString()
    : null;
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

function publicOffer(order) {
  return {
    id: order.id,
    subtotal: Number(order.subtotal || 0),
    total: Number(order.total || 0),
    currency: order.currency || 'usd',
    order_items: order.order_items,
  };
}

export async function runBuyerQuoteOfferAction({
  sb,
  user,
  action,
  quoteId,
  reason,
  stripe = null,
  now = () => new Date(),
}, dependencies = {}) {
  if (!['accept_offer', 'decline_offer'].includes(action)) {
    return { status: 400, body: { error: 'invalid_action' } };
  }
  if (!UUID.test(String(quoteId || ''))) {
    return { status: 400, body: { error: 'invalid_quote_id' } };
  }
  const prepareCheckoutMutation = dependencies.prepareQuoteCheckoutMutation
    || ((input) => prepareQuoteCheckoutMutation({
      ...input,
      stripe,
      store: createSupabaseQuoteCheckoutAttemptStore(sb),
    }));
  const releaseCheckoutMutation = dependencies.releaseQuoteCheckoutMutation
    || ((input) => releaseQuoteCheckoutMutation(
      createSupabaseQuoteCheckoutAttemptStore(sb),
      input,
    ));

  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return { status: 500, body: { error: 'server_error' } };
  const { data: quote, error: quoteError } = await sb.from('quotes')
    .select('id,source,payload,status,pipeline_stage,offer_revision,checkout_mutation_id,checkout_mutation_kind')
    .eq('id', quoteId)
    .neq('status', 'spam')
    .maybeSingle();
  if (quoteError) return { status: 500, body: { error: 'server_error' } };
  if (!quote) return { status: 404, body: { error: 'not_found' } };
  if (!quoteBuyerOwns(quote, { userId: user.id, companyId: profile?.company_id })) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  const actionNow = now();
  const actionAt = actionNow.toISOString();
  const expiry = await expireQuoteOfferIfDue(sb, quote, { at: actionAt });
  if (expiry.error) return { status: 500, body: { error: 'server_error' } };
  const currentQuote = expiry.quote;
  const offerOrderId = String(currentQuote.payload?.offer_order_id || '');
  const companyId = String(currentQuote.payload?.company_id || '');
  const requesterId = String(currentQuote.payload?.requester_id || '');
  if (!UUID.test(offerOrderId) || !UUID.test(companyId) || requesterId !== user.id) {
    return { status: 409, body: { error: 'offer_unavailable' } };
  }

  const { data: offer, error: offerError } = await sb.from('orders')
    .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('id', offerOrderId)
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .is('requisition_name', null)
    .maybeSingle();
  if (offerError) return { status: 500, body: { error: 'server_error' } };
  const actions = quoteBuyerActions(currentQuote, {
    userId: user.id,
    companyId: profile?.company_id,
    hasOffer: Boolean(offer?.order_items?.length),
    now: actionNow.getTime(),
  });

  if (action === 'decline_offer') {
    if (!actions.can_decline) return { status: 409, body: { error: 'offer_unavailable' } };
    const declineReason = String(reason || '').trim().slice(0, 500);
    let mutationId = null;
    const identity = {
      quoteId: currentQuote.id,
      quoteOrderId: offerOrderId,
      requesterId,
      companyId,
      offerRevision: Number(currentQuote.offer_revision),
      offerStatus: String(currentQuote.payload?.offer_status || ''),
    };
    if (currentQuote.payload?.offer_status === 'accepted') {
      try {
        const prepared = await prepareCheckoutMutation({
          sb,
          kind: 'decline',
          identity,
        });
        mutationId = prepared.mutationId;
      } catch (error) {
        if (error instanceof QuoteCheckoutAttemptError) {
          return {
            status: error.status,
            body: { error: error.code, ...(error.retryable ? { retryable: true } : {}) },
          };
        }
        return {
          status: 503,
          body: { error: 'quote_checkout_attempt_unavailable', retryable: true },
        };
      }
    }
    const payload = quotePayloadWithOffer(currentQuote.payload, {
      orderId: currentQuote.payload?.offer_order_id,
      status: 'declined',
      at: actionAt,
    });
    if (declineReason) payload.offer_declined_reason = declineReason;
    const declineQuery = sb.from('quotes')
      .update({
        payload,
        status: 'closed',
        pipeline_stage: 'lost',
        next_step: declineReason
          ? `Buyer declined: ${declineReason}`
          : 'Buyer declined the quote',
        handled_at: actionAt,
        ...(mutationId ? {
          checkout_mutation_id: null,
          checkout_mutation_kind: null,
          checkout_mutation_order_id: null,
          checkout_mutation_offer_revision: null,
        } : {}),
      })
      .eq('id', currentQuote.id)
      .eq('status', currentQuote.status)
      .eq('offer_revision', Number(currentQuote.offer_revision));
    if (mutationId) {
      declineQuery
        .eq('checkout_mutation_id', mutationId)
        .eq('checkout_mutation_order_id', offerOrderId)
        .eq('checkout_mutation_offer_revision', Number(currentQuote.offer_revision));
    }
    const { data: declined, error: declineError } = await guardQuoteOffer(
      declineQuery,
      currentQuote.payload,
    ).select('id').maybeSingle();
    if (declineError || !declined) {
      if (mutationId) {
        await releaseCheckoutMutation({
          sb,
          mutationId,
          identity: {
            quoteId: currentQuote.id,
            quoteOrderId: offerOrderId,
            offerRevision: Number(currentQuote.offer_revision),
          },
        }).catch(() => {});
      }
      if (declineError) return { status: 500, body: { error: 'server_error' } };
      return { status: 409, body: { error: 'quote_changed' } };
    }
    return {
      status: 200,
      body: { ok: true, quote_id: currentQuote.id, declined: true },
    };
  }

  if (currentQuote.payload?.offer_status === 'ordered') {
    return {
      status: 409,
      body: {
        error: 'already_ordered',
        order_id: currentQuote.payload?.final_order_id || null,
      },
    };
  }
  if (currentQuote.payload?.offer_status === 'payment_pending') {
    return {
      status: 409,
      body: {
        error: 'payment_pending',
        order_id: currentQuote.payload?.final_order_id || null,
      },
    };
  }
  if (!actions.can_accept) return { status: 409, body: { error: 'offer_unavailable' } };
  if (currentQuote.payload?.offer_status === 'accepted') {
    return {
      status: 200,
      body: { ok: true, quote_id: currentQuote.id, offer: publicOffer(offer) },
    };
  }

  const payload = quotePayloadWithOffer(currentQuote.payload, {
    orderId: offer.id,
    status: 'accepted',
    at: actionAt,
  });
  const updateQuery = sb.from('quotes')
    .update({
      payload,
      status: 'contacted',
      next_step: 'Buyer accepted; awaiting checkout',
      handled_at: actionAt,
    })
    .eq('id', currentQuote.id)
    .eq('status', currentQuote.status);
  const { data: updated, error: updateError } = await guardQuoteOffer(
    updateQuery,
    currentQuote.payload,
  ).select('id').maybeSingle();
  if (updateError) return { status: 500, body: { error: 'server_error' } };
  if (!updated) return { status: 409, body: { error: 'quote_changed' } };
  return {
    status: 200,
    body: { ok: true, quote_id: currentQuote.id, offer: publicOffer(offer) },
  };
}

export async function sendQuoteOffer({
  store,
  id,
  items,
  expiresAt: requestedExpiresAt,
  actor,
  user,
}, {
  audit = async () => {},
  prepareCheckoutChange = null,
  releaseCheckoutChange = async () => {},
  now = () => new Date(),
} = {}) {
  let order = null;
  let committed = false;
  let checkoutMutation = null;
  let checkoutMutationIdentity = null;
  try {
    const atDate = now();
    const expiresAt = offerExpiry(requestedExpiresAt, atDate);
    if (!expiresAt) return { status: 400, body: { error: 'future_offer_expiry_required' } };
    const quote = await store.offerQuote(id);
    if (!quote) return { status: 404, body: { error: 'quote_not_found' } };
    if (!requisitionQuoteMayBeSent(quote, atDate.getTime())) {
      return { status: 409, body: { error: 'quote_closed' } };
    }
    const requisitionId = String(quote.payload?.requisition_id || '');
    const requesterId = String(quote.payload?.requester_id || '');
    const companyId = String(quote.payload?.company_id || '');
    if (quote.source !== 'requisition' || !UUID.test(requisitionId)
      || !UUID.test(requesterId) || !UUID.test(companyId)) {
      return { status: 409, body: { error: 'invalid_requisition_quote' } };
    }

    const requisition = await store.requisition({ requisitionId, requesterId, companyId });
    if (!requisition) return { status: 409, body: { error: 'requisition_unavailable' } };
    const built = buildConvertItems(items);
    if (built.error) return { status: 400, body: { error: built.error } };
    const sourceBySku = new Map((requisition.order_items || [])
      .map((item) => [item.sku, item]));
    if (built.items.some((item) => !sourceBySku.has(item.sku))) {
      return { status: 400, body: { error: 'item_not_in_requisition' } };
    }
    const clean = built.items.map((item) => ({
      ...item,
      product_sku: sourceBySku.get(item.sku)?.product_sku || item.product_sku,
      name: sourceBySku.get(item.sku)?.name || item.name,
    }));
    const currency = String(requisition.currency || 'usd').toLowerCase();
    order = await store.createOrder(quoteOrderRow({
      companyId,
      userId: requesterId,
      email: String(quote.email || '').toLowerCase(),
      subtotal: built.subtotal,
      currency,
    }));
    await store.insertOrderItems(order.id, clean);

    const at = atDate.toISOString();
    const previousOfferOrderId = String(quote.payload?.offer_order_id || '');
    const nextOfferStatus = quote.payload?.offer_status ? 'revised' : 'sent';
    if (!canTransitionOffer(quote, nextOfferStatus, atDate.getTime())) {
      await store.deleteOrder(order.id);
      return { status: 409, body: { error: 'quote_changed' } };
    }
    if (UUID.test(previousOfferOrderId)) {
      if (!prepareCheckoutChange || !Number.isSafeInteger(Number(quote.offer_revision))
        || Number(quote.offer_revision) < 1) {
        await store.deleteOrder(order.id);
        return {
          status: 503,
          body: { error: 'quote_checkout_attempt_unavailable', retryable: true },
        };
      }
      try {
        checkoutMutationIdentity = {
          quoteId: quote.id,
          quoteOrderId: previousOfferOrderId,
          requesterId,
          companyId,
          offerRevision: Number(quote.offer_revision),
          offerStatus: String(quote.payload?.offer_status || ''),
        };
        checkoutMutation = await prepareCheckoutChange({
          kind: 'revise',
          identity: checkoutMutationIdentity,
        });
      } catch (error) {
        await store.deleteOrder(order.id);
        return {
          status: Number(error?.status) || 503,
          body: {
            error: error?.code || 'quote_checkout_attempt_unavailable',
            ...(error?.retryable ? { retryable: true } : {}),
          },
        };
      }
      if (!UUID.test(String(checkoutMutation?.mutationId || ''))) {
        await store.deleteOrder(order.id);
        return {
          status: 503,
          body: { error: 'quote_checkout_attempt_unavailable', retryable: true },
        };
      }
    }
    const payload = quotePayloadWithOffer(quote.payload, {
      orderId: order.id,
      status: nextOfferStatus,
      at,
      expiresAt,
    });
    const effects = toIntegrationEffectRows(quoteOfferEffects({
      quoteId: quote.id,
      companyId,
      email: quote.email,
      product: quote.product,
    }));
    const updated = await store.commitOffer({
      quote,
      payload,
      orderId: order.id,
      actor,
      dealValue: built.subtotal,
      expiresAt,
      eventId: `quote:${quote.id}:${order.id}`,
      effects,
      checkoutMutationId: checkoutMutation?.mutationId || null,
    });
    if (!updated) {
      if (checkoutMutation?.mutationId) {
        await releaseCheckoutChange({
          mutationId: checkoutMutation.mutationId,
          identity: checkoutMutationIdentity,
        }).catch(() => {});
      }
      await store.deleteOrder(order.id);
      return { status: 409, body: { error: 'quote_changed' } };
    }
    committed = true;

    if (UUID.test(previousOfferOrderId) && previousOfferOrderId !== order.id) {
      await store.deleteOrder(previousOfferOrderId, {
        companyId,
        requesterId,
        status: 'cart',
        requisitionName: null,
      }).catch(() => {});
    }
    await Promise.allSettled([audit({
      user,
      action: nextOfferStatus === 'revised' ? 'quote.revise' : 'quote.send',
      targetType: 'quote',
      targetId: quote.id,
      detail: {
        company_id: companyId,
        order_id: order.id,
        subtotal: built.subtotal,
        expires_at: expiresAt,
        delivery: 'queued',
      },
    })]);
    return {
      status: 202,
      body: { ok: true, order_id: order.id, quote: updated, delivery_state: 'queued' },
    };
  } catch (error) {
    if (checkoutMutation?.mutationId && !committed) {
      await releaseCheckoutChange({
        mutationId: checkoutMutation.mutationId,
        identity: checkoutMutationIdentity,
      }).catch(() => {});
    }
    if (order && !committed) await store.deleteOrder(order.id).catch(() => {});
    if (error?.code === '23505' && /quotes_open_requisition_unique_idx/.test(error?.message || '')) {
      return { status: 409, body: { error: 'open_quote_exists' } };
    }
    return { status: 500, body: { error: error?.message || String(error) } };
  }
}

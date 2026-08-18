// GET /api/account/quotes lists the authenticated caller's customer-safe quote state.
// POST { action: 'accept_offer', id } returns only the caller's server-owned offer lines.
// Public requests are matched by the auth email because they can predate an account.
// Requisition offers use only their immutable requester + current Company ownership.
// Customer-safe fields only — internal triage data (priority, lead score, staff
// notes, deal value) never leaves this endpoint.
import Stripe from 'stripe';
import { userFromRequest, adminClient, json } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { escapeLike } from '../../_lib/crm.js';
import { quotePayloadWithOffer } from '../../_lib/quote-convert.js';
import { expireQuoteOfferIfDue, guardQuoteOffer } from '../../_lib/quote-order.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';
import { quoteBuyerActions, quoteBuyerOwns, quoteLifecycle } from '../../_lib/quote-lifecycle.js';
import {
  createSupabaseQuoteCheckoutAttemptStore,
  prepareQuoteCheckoutMutation,
  QuoteCheckoutAttemptError,
  releaseQuoteCheckoutMutation,
} from '../../_lib/quote-checkout-attempt.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPT_BODY_MAX_BYTES = 4 * 1024;

// The buyer-visible state comes from the shared lifecycle module so staff and buyer can
// never be looking at two different names for the same quote.
function publicState(quote, now = Date.now()) {
  return quoteLifecycle(quote, now).label;
}

export async function onRequestGet({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const clock = dependencies.now || (() => new Date());
  const { user } = dependencies.userFromRequest
    ? await dependencies.userFromRequest(request, env)
    : await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const email = String(user.email || '').trim();

  const sb = getAdminClient(env);
  const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 25, maxLimit: 100 });
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: 'server_error' });

  // Keep the two identity systems disjoint. This avoids putting an auth email inside a
  // raw PostgREST OR expression and ensures an account email change cannot revoke an
  // otherwise-owned requisition offer. Each branch fetches enough rows to merge one
  // globally ordered page without losing a later match.
  const select = 'id,created_at,type,product,industry,status,pipeline_stage,source,payload';
  const through = offset + limit - 1;
  const reads = [];
  if (email) {
    reads.push(sb.from('quotes')
      .select(select, { count: 'exact' })
      .ilike('email', escapeLike(email))
      .neq('status', 'spam')
      .or('source.is.null,source.neq.requisition')
      .order('created_at', { ascending: false })
      .range(0, through));
  }
  if (profile?.company_id) {
    reads.push(sb.from('quotes')
      .select(select, { count: 'exact' })
      .eq('source', 'requisition')
      .contains('payload', { requester_id: user.id, company_id: profile.company_id })
      .neq('status', 'spam')
      .order('created_at', { ascending: false })
      .range(0, through));
  }
  if (!reads.length) {
    return json(200, { quotes: [], ...pageEnvelope([], { limit, offset, count: 0 }) }, { 'cache-control': 'private, no-store' });
  }
  const results = await Promise.all(reads);
  const failed = results.find(({ error }) => error);
  if (failed?.error) {
    if (/does not exist|relation|schema cache/i.test(failed.error.message)) return json(200, { quotes: [] });
    return json(500, { error: 'server_error' });
  }
  const allCountsExact = results.every(({ count }) => Number.isFinite(count));
  const count = allCountsExact
    ? results.reduce((sum, result) => sum + result.count, 0)
    : null;
  const data = [...new Map(results
    .flatMap((result) => result.data || [])
    .map((quote) => [quote.id, quote])).values()]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(offset, offset + limit);
  const now = clock().toISOString();
  const refreshed = await Promise.all((data || []).map(async (quote) => {
    const expired = await expireQuoteOfferIfDue(sb, quote, { at: now });
    if (expired.error) throw expired.error;
    return expired.quote;
  })).catch(() => null);
  if (!refreshed) return json(500, { error: 'server_error' });

  const offerOrderIds = [...new Set(refreshed
    .map((quote) => String(quote.payload?.offer_order_id || ''))
    .filter((id) => UUID.test(id)))];
  let offers = [];
  if (offerOrderIds.length) {
    if (profile?.company_id) {
      const { data: rows, error: offerError } = await sb.from('orders')
        .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
        .in('id', offerOrderIds)
        .eq('company_id', profile.company_id)
        .eq('user_id', user.id)
        .eq('status', 'cart')
        .is('requisition_name', null);
      if (offerError) return json(500, { error: 'server_error' });
      offers = rows || [];
    }
  }
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  const quotes = refreshed.map((q) => {
    const offer = offerById.get(q.payload?.offer_order_id);
    const actions = quoteBuyerActions(q, {
      userId: user.id,
      companyId: profile?.company_id,
      hasOffer: Boolean(offer),
      now: Date.parse(now),
    });
    return {
      id: q.id,
      created_at: q.created_at,
      type: q.type || 'quote',
      product: q.product || '',
      industry: q.industry || '',
      state: publicState(q, Date.parse(now)),
      lifecycle: quoteLifecycle(q, Date.parse(now)),
      expires_at: q.payload?.offer_expires_at || null,
      offer: offer ? {
        id: offer.id,
        subtotal: Number(offer.subtotal || 0),
        total: Number(offer.total || 0),
        currency: offer.currency || 'usd',
        order_items: offer.order_items || [],
      } : null,
      ...actions,
    };
  });
  return json(200, { quotes, ...pageEnvelope(data, { limit, offset, count }) }, { 'cache-control': 'private, no-store' });
}

export async function onRequestPost({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const clock = dependencies.now || (() => new Date());
  const prepareCheckoutMutation = dependencies.prepareQuoteCheckoutMutation
    || ((input) => prepareQuoteCheckoutMutation({
      ...input,
      stripe: env.STRIPE_SECRET_KEY
        ? new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
        : null,
      store: createSupabaseQuoteCheckoutAttemptStore(input.sb),
    }));
  const { user } = dependencies.userFromRequest
    ? await dependencies.userFromRequest(request, env)
    : await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  let body;
  try {
    body = await readBoundedJson(request, ACCEPT_BODY_MAX_BYTES);
  } catch (error) {
    return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
      error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request' });
  if (!['accept_offer', 'decline_offer'].includes(body.action)) return json(400, { error: 'invalid_action' });
  const quoteId = String(body.id || '');
  if (!UUID.test(quoteId)) return json(400, { error: 'invalid_quote_id' });

  const sb = getAdminClient(env);
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: 'server_error' });
  const { data: quote, error: quoteError } = await sb.from('quotes')
    .select('id,source,payload,status,pipeline_stage,offer_revision,checkout_mutation_id,checkout_mutation_kind')
    .eq('id', quoteId)
    .neq('status', 'spam')
    .maybeSingle();
  if (quoteError) return json(500, { error: 'server_error' });
  if (!quote) return json(404, { error: 'not_found' });

  // Email locates legacy/public requests, but never authorizes a requisition mutation.
  if (!quoteBuyerOwns(quote, { userId: user.id, companyId: profile?.company_id })) {
    return json(403, { error: 'forbidden' });
  }
  const actionAt = clock().toISOString();
  const expiry = await expireQuoteOfferIfDue(sb, quote, { at: actionAt });
  if (expiry.error) return json(500, { error: 'server_error' });
  const currentQuote = expiry.quote;
  const offerOrderId = String(currentQuote.payload?.offer_order_id || '');
  const companyId = String(currentQuote.payload?.company_id || '');
  const requesterId = String(currentQuote.payload?.requester_id || '');
  if (!UUID.test(offerOrderId) || !UUID.test(companyId) || requesterId !== user.id) {
    return json(409, { error: 'offer_unavailable' });
  }

  const { data: offer, error: offerError } = await sb.from('orders')
    .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('id', offerOrderId)
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .is('requisition_name', null)
    .maybeSingle();
  if (offerError) return json(500, { error: 'server_error' });
  const actions = quoteBuyerActions(currentQuote, {
    userId: user.id,
    companyId: profile?.company_id,
    hasOffer: Boolean(offer?.order_items?.length),
  });

  // Declining closes the loop without touching the draft order: staff may still revise and
  // re-send, and the reason lands on the CRM record where follow-up decisions get made.
  if (body.action === 'decline_offer') {
    if (!actions.can_decline) return json(409, { error: 'offer_unavailable' });
    const declinedAt = actionAt;
    const reason = String(body.reason || '').trim().slice(0, 500);
    let mutationId = null;
    if (currentQuote.payload?.offer_status === 'accepted') {
      try {
        const prepared = await prepareCheckoutMutation({
          sb,
          env,
          kind: 'decline',
          identity: {
            quoteId: currentQuote.id,
            quoteOrderId: offerOrderId,
            requesterId,
            companyId,
            offerRevision: Number(currentQuote.offer_revision),
            offerStatus: String(currentQuote.payload?.offer_status || ''),
          },
        });
        mutationId = prepared.mutationId;
      } catch (error) {
        if (error instanceof QuoteCheckoutAttemptError) {
          return json(error.status, { error: error.code, ...(error.retryable ? { retryable: true } : {}) });
        }
        return json(503, { error: 'quote_checkout_attempt_unavailable', retryable: true });
      }
    }
    const payload = quotePayloadWithOffer(currentQuote.payload, {
      orderId: currentQuote.payload?.offer_order_id,
      status: 'declined',
      at: declinedAt,
    });
    if (reason) payload.offer_declined_reason = reason;
    const declineQuery = sb.from('quotes')
      .update({
        payload,
        status: 'closed',
        pipeline_stage: 'lost',
        next_step: reason ? `Buyer declined: ${reason}` : 'Buyer declined the quote',
        handled_at: declinedAt,
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
    const { data: declined, error: declineError } = await guardQuoteOffer(declineQuery, currentQuote.payload)
      .select('id')
      .maybeSingle();
    if (declineError || !declined) {
      if (mutationId) {
        await (dependencies.releaseQuoteCheckoutMutation
          ? dependencies.releaseQuoteCheckoutMutation({
            sb,
            mutationId,
            identity: {
              quoteId: currentQuote.id,
              quoteOrderId: offerOrderId,
              offerRevision: Number(currentQuote.offer_revision),
            },
          })
          : releaseQuoteCheckoutMutation(createSupabaseQuoteCheckoutAttemptStore(sb), {
            mutationId,
            identity: {
              quoteId: currentQuote.id,
              quoteOrderId: offerOrderId,
              offerRevision: Number(currentQuote.offer_revision),
            },
          })).catch(() => {});
      }
      if (declineError) return json(500, { error: 'server_error' });
      return json(409, { error: 'quote_changed' });
    }
    return json(200, { ok: true, quote_id: currentQuote.id, declined: true }, { 'cache-control': 'private, no-store' });
  }
  if (currentQuote.payload?.offer_status === 'ordered') {
    return json(409, { error: 'already_ordered', order_id: currentQuote.payload?.final_order_id || null });
  }
  if (currentQuote.payload?.offer_status === 'payment_pending') {
    return json(409, { error: 'payment_pending', order_id: currentQuote.payload?.final_order_id || null });
  }
  if (!actions.can_accept) {
    return json(409, { error: 'offer_unavailable' });
  }

  // Re-loading an already accepted offer is idempotent and does not restamp the CAS row.
  if (currentQuote.payload?.offer_status === 'accepted') {
    return json(200, {
      ok: true,
      quote_id: currentQuote.id,
      offer: {
        id: offer.id,
        subtotal: Number(offer.subtotal || 0),
        total: Number(offer.total || 0),
        currency: offer.currency || 'usd',
        order_items: offer.order_items,
      },
    }, { 'cache-control': 'private, no-store' });
  }

  const at = actionAt;
  const payload = quotePayloadWithOffer(currentQuote.payload, {
    orderId: offer.id,
    status: 'accepted',
    at,
  });
  const updateQuery = sb.from('quotes')
    .update({
      payload,
      status: 'contacted',
      next_step: 'Buyer accepted; awaiting checkout',
      handled_at: at,
    })
    .eq('id', currentQuote.id)
    .eq('status', currentQuote.status);
  const { data: updated, error: updateError } = await guardQuoteOffer(updateQuery, currentQuote.payload)
    .select('id')
    .maybeSingle();
  if (updateError) return json(500, { error: 'server_error' });
  if (!updated) return json(409, { error: 'quote_changed' });
  return json(200, {
    ok: true,
    quote_id: currentQuote.id,
    offer: {
      id: offer.id,
      subtotal: Number(offer.subtotal || 0),
      total: Number(offer.total || 0),
      currency: offer.currency || 'usd',
      order_items: offer.order_items,
    },
  }, { 'cache-control': 'private, no-store' });
}

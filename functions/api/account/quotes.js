// GET /api/account/quotes lists the authenticated caller's customer-safe quote state.
// POST { action: 'accept_offer', id } returns only the caller's server-owned offer lines.
// Public requests are matched by the auth email because they can predate an account.
// Requisition offers use only their immutable requester + current Company ownership.
// Customer-safe fields only — internal triage data (priority, lead score, staff
// notes, deal value) never leaves this endpoint.
import { userFromRequest, adminClient, json } from '../../_lib/supabase.js';
import { createStripeClient } from '../../_lib/stripe-client.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { escapeLike } from '../../_lib/crm.js';
import {
  expireQuoteOfferIfDue,
  runBuyerQuoteOfferAction,
} from '../../_lib/quote-offer.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';
import { quoteBuyerActions, quoteLifecycle } from '../../_lib/quote-lifecycle.js';

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'bad_request' });
  }
  const sb = getAdminClient(env);
  const runOfferAction = dependencies.runBuyerQuoteOfferAction || runBuyerQuoteOfferAction;
  const result = await runOfferAction({
    sb,
    user,
    action: body.action,
    quoteId: body.id,
    reason: body.reason,
    now: clock,
    stripe: env.STRIPE_SECRET_KEY
      ? createStripeClient(env.STRIPE_SECRET_KEY)
      : null,
  }, {
    prepareQuoteCheckoutMutation: dependencies.prepareQuoteCheckoutMutation,
    releaseQuoteCheckoutMutation: dependencies.releaseQuoteCheckoutMutation,
  });
  return json(result.status, result.body, { 'cache-control': 'private, no-store' });
}

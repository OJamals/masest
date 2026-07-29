// GET /api/account/quotes lists the authenticated caller's customer-safe quote state.
// POST { action: 'accept_offer', id } returns only the caller's server-owned offer lines.
// Matched by the email on the auth account: quote requests arrive through the
// public form, often before an account or company exists, so email is the join.
// Customer-safe fields only — internal triage data (priority, lead score, staff
// notes, deal value) never leaves this endpoint.
import { userFromRequest, adminClient, json } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { escapeLike } from '../../_lib/crm.js';
import { quotePayloadWithOffer } from '../../_lib/quote-convert.js';
import { guardQuoteOffer } from '../../_lib/quote-order.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPT_BODY_MAX_BYTES = 4 * 1024;

// Internal status/pipeline stage → the state a customer should see.
function publicState(quote) {
  if (quote.payload?.offer_status === 'ordered') return 'Order placed';
  if (quote.payload?.offer_status === 'payment_pending') return 'Payment pending';
  if (quote.payload?.offer_status === 'accepted') return 'Accepted';
  if (quote.payload?.offer_status === 'sent') return 'Quote ready';
  if (quote.pipeline_stage === 'won') return 'Quoted';
  if (quote.pipeline_stage === 'lost' || quote.status === 'closed') return 'Closed';
  if (quote.status === 'contacted' || (quote.pipeline_stage && quote.pipeline_stage !== 'new')) return 'In review';
  return 'Received';
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const email = String(user.email || '').trim();
  if (!email) return json(200, { quotes: [] });

  const sb = adminClient(env);
  const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 25, maxLimit: 100 });
  // ilike with escaped input = case-insensitive exact match (stored casing varies).
  const { data, error, count } = await sb.from('quotes')
    .select('id,created_at,type,product,industry,status,pipeline_stage,source,payload', { count: 'exact' })
    .ilike('email', escapeLike(email))
    .neq('status', 'spam')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { quotes: [] });
    return json(500, { error: 'server_error' });
  }
  const offerOrderIds = [...new Set((data || [])
    .map((quote) => String(quote.payload?.offer_order_id || ''))
    .filter((id) => UUID.test(id)))];
  let offers = [];
  if (offerOrderIds.length) {
    const { data: profile, error: profileError } = await sb.from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) return json(500, { error: 'server_error' });
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
  const quotes = (data || []).map((q) => {
    const offer = offerById.get(q.payload?.offer_order_id);
    return {
      id: q.id,
      created_at: q.created_at,
      type: q.type || 'quote',
      product: q.product || '',
      industry: q.industry || '',
      state: publicState(q),
      offer: offer ? {
        id: offer.id,
        subtotal: Number(offer.subtotal || 0),
        total: Number(offer.total || 0),
        currency: offer.currency || 'usd',
        order_items: offer.order_items || [],
      } : null,
      can_accept: ['sent', 'accepted'].includes(q.payload?.offer_status)
        && offerById.has(q.payload?.offer_order_id),
    };
  });
  return json(200, { quotes, ...pageEnvelope(data, { limit, offset, count }) }, { 'cache-control': 'private, no-store' });
}

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const email = String(user.email || '').trim();
  if (!email) return json(409, { error: 'email_required' });

  let body;
  try {
    body = await readBoundedJson(request, ACCEPT_BODY_MAX_BYTES);
  } catch (error) {
    return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
      error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request' });
  if (body.action !== 'accept_offer') return json(400, { error: 'invalid_action' });
  const quoteId = String(body.id || '');
  if (!UUID.test(quoteId)) return json(400, { error: 'invalid_quote_id' });

  const sb = adminClient(env);
  const { data: quote, error: quoteError } = await sb.from('quotes')
    .select('id,payload,status,pipeline_stage')
    .eq('id', quoteId)
    .ilike('email', escapeLike(email))
    .neq('status', 'spam')
    .maybeSingle();
  if (quoteError) return json(500, { error: 'server_error' });
  if (!quote) return json(404, { error: 'not_found' });
  if (quote.payload?.offer_status === 'ordered') {
    return json(409, { error: 'already_ordered', order_id: quote.payload?.final_order_id || null });
  }
  if (quote.payload?.offer_status === 'payment_pending') {
    return json(409, { error: 'payment_pending', order_id: quote.payload?.final_order_id || null });
  }
  if (quote.status === 'closed') return json(409, { error: 'quote_unavailable' });
  if (!['sent', 'accepted'].includes(quote.payload?.offer_status)) {
    return json(409, { error: 'offer_unavailable' });
  }

  const offerOrderId = String(quote.payload?.offer_order_id || '');
  const companyId = String(quote.payload?.company_id || '');
  const requesterId = String(quote.payload?.requester_id || '');
  if (!UUID.test(offerOrderId) || !UUID.test(companyId) || requesterId !== user.id) {
    return json(409, { error: 'offer_unavailable' });
  }
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: 'server_error' });
  if (profile?.company_id !== companyId) return json(403, { error: 'forbidden' });

  const { data: offer, error: offerError } = await sb.from('orders')
    .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('id', offerOrderId)
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .is('requisition_name', null)
    .maybeSingle();
  if (offerError) return json(500, { error: 'server_error' });
  if (!offer?.order_items?.length) return json(409, { error: 'offer_unavailable' });

  const at = new Date().toISOString();
  const payload = quotePayloadWithOffer(quote.payload, {
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
    .eq('id', quote.id)
    .eq('status', quote.status);
  const { data: updated, error: updateError } = await guardQuoteOffer(updateQuery, quote.payload)
    .select('id')
    .maybeSingle();
  if (updateError) return json(500, { error: 'server_error' });
  if (!updated) return json(409, { error: 'quote_changed' });
  return json(200, {
    ok: true,
    quote_id: quote.id,
    offer: {
      id: offer.id,
      subtotal: Number(offer.subtotal || 0),
      total: Number(offer.total || 0),
      currency: offer.currency || 'usd',
      order_items: offer.order_items,
    },
  }, { 'cache-control': 'private, no-store' });
}

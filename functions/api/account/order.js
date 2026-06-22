// /api/account/order?id=<uuid> - single order detail scoped to caller's company.
//   GET                 → order detail | GET ?receipt=1 → { receipt_url, qbo_invoice_id }
//   POST { id }         → "buy again": re-priced cart lines + availability issues
import Stripe from 'stripe';
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../../_lib/supabase.js';
import { repriceCart } from '../../_lib/reorder.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  const { data, error } = await sb
    .from('orders')
    .select('id,status,payment_method,subtotal,tax,total,currency,created_at,qbo_invoice_id,stripe_payment_intent,ship_address,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!data) return json(404, { error: 'not_found' });

  // Receipt lookup: hosted Stripe receipt for card orders; QBO invoice id otherwise.
  if (url.searchParams.get('receipt')) {
    let receiptUrl = null;
    if (data.payment_method === 'stripe' && data.stripe_payment_intent && env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
        const pi = await stripe.paymentIntents.retrieve(data.stripe_payment_intent, { expand: ['latest_charge'] });
        receiptUrl = pi?.latest_charge?.receipt_url || null;
      } catch { receiptUrl = null; }
    }
    return json(200, { receipt_url: receiptUrl, qbo_invoice_id: data.qbo_invoice_id || null });
  }

  delete data.stripe_payment_intent; // internal-only; not part of the order view
  return json(200, { order: data });
}

// "Buy again": re-price the order's items against the current catalog and return
// cart lines (checkout re-prices authoritatively). Reports dropped/changed items.
export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const body = await readBody(request);
  const id = body.id || new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  const { data: order, error } = await sb
    .from('orders')
    .select('id,order_items(sku,name,qty,unit_price)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!order) return json(404, { error: 'not_found' });

  const skus = (order.order_items || []).map((i) => i.sku).filter(Boolean);
  const { data: variants } = skus.length
    ? await sb.from('product_variants').select('vsku,price,active').in('vsku', skus)
    : { data: [] };
  const map = {};
  for (const v of variants || []) map[v.vsku] = v;

  const { lines, issues } = repriceCart(order.order_items, map);
  return json(200, { lines, issues });
}

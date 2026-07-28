// /api/account/order?id=<uuid> - single order detail scoped to caller's company.
//   GET                 → order detail | GET ?receipt=1 → { receipt_url, qbo_invoice_id }
//   POST { id }         → "buy again": re-priced cart lines + availability issues
import Stripe from 'stripe';
import { requireCompany, json, readBody } from '../../_lib/supabase.js';
import { repriceCart } from '../../_lib/reorder.js';
import { decorateOrderLifecycle } from '../../_lib/order-lifecycle.js';

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, user, sb } = ctx;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const { data, error } = await sb
    .from('orders')
    .select('id,user_id,status,payment_method,subtotal,shipping,tax,total,currency,purchase_order_number,created_at,qbo_invoice_id,qbo_sync_status,stripe_payment_intent,ship_address,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total),shipment_events(status,note,created_at)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!data) return json(404, { error: 'not_found' });
  if (data.status === 'cart' && data.user_id !== user.id) return json(404, { error: 'not_found' });

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

  delete data.user_id;
  delete data.stripe_payment_intent; // internal-only; not part of the order view
  return json(200, { order: decorateOrderLifecycle(data) });
}

// "Buy again": re-price the order's items against the current catalog and return
// cart lines (checkout re-prices authoritatively). Reports dropped/changed items.
export async function onRequestPost({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, user, sb } = ctx;
  const body = await readBody(request);
  const id = body.id || new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'order_id_required' });

  const { data: order, error } = await sb
    .from('orders')
    .select('id,user_id,status,order_items(sku,name,qty,unit_price)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!order) return json(404, { error: 'not_found' });
  if (order.status === 'cart' && order.user_id !== user.id) return json(404, { error: 'not_found' });

  const skus = (order.order_items || []).map((i) => i.sku).filter(Boolean);
  const { data: variants } = skus.length
    ? await sb.from('product_variants').select('vsku,price,active').in('vsku', skus)
    : { data: [] };
  const map = {};
  for (const v of variants || []) map[v.vsku] = v;

  const { lines, issues } = repriceCart(order.order_items, map);
  return json(200, { lines, issues });
}

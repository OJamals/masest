// Company order history and buyer-owned saved requisitions.
import {
  json,
  requireCompany,
  tierForRequest,
  tierPriceMap,
} from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { decorateOrderLifecycle } from '../../_lib/order-lifecycle.js';
import { normalizeCartQuantities } from '../../_lib/order-shape.js';
import {
  findOpenRequisitionQuote,
  isOpenRequisitionQuoteConflict,
} from '../../_lib/quote-order.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';

const REQUISITION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUISITION_NAME_MAX = 80;
const REQUISITION_BODY_MAX_BYTES = 16 * 1024;

function requisitionName(value) {
  const name = String(value || '').trim();
  return name && name.length <= REQUISITION_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name) ? name : '';
}

async function requestRequisitionQuote(sb, companyId, user, body) {
  const id = String(body.id || '');
  if (!REQUISITION_ID.test(id)) return json(400, { error: 'invalid_requisition_id' });

  const { data: requisition, error: requisitionError } = await sb.from('orders')
    .select('id,requisition_name,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .not('requisition_name', 'is', null)
    .maybeSingle();
  if (requisitionError) return json(500, { error: 'server_error' });
  if (!requisition) return json(404, { error: 'not_found' });
  if (!requisition.order_items?.length) return json(409, { error: 'empty_requisition' });

  const { quote: existing, error: existingError } = await findOpenRequisitionQuote(sb, requisition.id);
  if (existingError) return json(500, { error: 'server_error' });
  if (existing) return json(200, { quote: existing, existing: true }, { 'cache-control': 'no-store' });

  const { data: company, error: companyError } = await sb.from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError) return json(500, { error: 'server_error' });

  const { data: quote, error: quoteError } = await sb.from('quotes').insert({
    name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Buyer',
    email: String(user.email || '').toLowerCase(),
    company: company?.name || '',
    product: requisition.requisition_name,
    message: `Quote requested for saved requisition: ${requisition.requisition_name}`,
    source: 'requisition',
    status: 'new',
    pipeline_stage: 'new',
    next_step: 'Review requisition pricing and send quote',
    deal_value: Number(requisition.total || requisition.subtotal || 0),
    payload: {
      requisition_id: requisition.id,
      requester_id: user.id,
      company_id: companyId,
    },
  }).select('id,status,pipeline_stage,created_at').single();
  if (isOpenRequisitionQuoteConflict(quoteError)) {
    const { quote: raced, error: racedError } = await findOpenRequisitionQuote(sb, requisition.id);
    if (!racedError && raced) {
      return json(200, { quote: raced, existing: true }, { 'cache-control': 'no-store' });
    }
  }
  if (quoteError) return json(500, { error: 'server_error' });
  return json(201, { quote }, { 'cache-control': 'no-store' });
}

async function priceRequisition(sb, request, env, qtyBySku) {
  const skus = Object.keys(qtyBySku);
  const { data, error } = await sb.from('product_variants')
    .select('vsku,product_sku,label,price,currency,active,products(name,mode,active)')
    .in('vsku', skus);
  if (error) return { error: 'server_error' };
  const bySku = new Map((data || []).map((variant) => [variant.vsku, variant]));
  const { tier } = await tierForRequest(request, env);
  const prices = tier === 'retail' ? new Map() : await tierPriceMap(sb, tier);
  const lines = [];
  for (const sku of skus) {
    const variant = bySku.get(sku);
    const product = variant?.products;
    const unitPrice = Number(prices.get(sku) ?? variant?.price);
    if (!variant || variant.active === false || !Number.isFinite(unitPrice)
      || !product || product.active === false || product.mode !== 'buy') {
      return { error: 'not_purchasable', skus: [sku] };
    }
    const qty = qtyBySku[sku];
    lines.push({
      sku,
      product_sku: variant.product_sku,
      name: `${product.name} - ${variant.label}`,
      qty,
      unit_price: unitPrice,
      line_total: unitPrice * qty,
      currency: String(variant.currency || 'usd').toLowerCase(),
    });
  }
  const currencies = new Set(lines.map((line) => line.currency));
  return currencies.size > 1 ? { error: 'mixed_currency' } : { lines };
}

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, user, sb } = ctx;

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset } = parsePage(searchParams, { defaultLimit: 25, maxLimit: 100 });
  const wantsSummary = searchParams.get('summary') === '1';
  const ordersQuery = sb.from('orders')
    .select('id,order_number,status,payment_method,subtotal,shipping,tax,total,currency,purchase_order_number,created_at,qbo_invoice_id,qbo_sync_status,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,order_items(sku,product_sku,name,qty,unit_price,line_total),shipment_events(status,note,created_at)', { count: 'exact' })
    .eq('company_id', companyId)
    .neq('status', 'cart')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const activeQuery = wantsSummary
    ? sb.from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .not('status', 'in', '(cart,cancelled,refunded)')
      .or('tracking_status.is.null,tracking_status.neq.delivered,status.not.in.(paid,net_paid,fulfilled)')
    : Promise.resolve({ count: 0, error: null });
  const requisitionsQuery = sb.from('orders')
    .select('id,requisition_name,subtotal,total,currency,created_at,order_items(sku,product_sku,name,qty,unit_price,line_total)')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .not('requisition_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(25);
  const [
    { data, error, count },
    { count: activeTotal, error: summaryError },
    { data: requisitions, error: requisitionsError },
  ] = await Promise.all([ordersQuery, activeQuery, requisitionsQuery]);
  if (error || summaryError || requisitionsError) return json(500, { error: 'server_error' });
  const orders = (data || []).map(decorateOrderLifecycle);
  return json(200, {
    orders,
    requisitions: requisitions || [],
    ...pageEnvelope(data, { limit, offset, count }),
    ...(wantsSummary ? { active_total: activeTotal || 0 } : {}),
  }, { 'cache-control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, user, sb } = ctx;
  let body;
  try {
    body = await readBoundedJson(request, REQUISITION_BODY_MAX_BYTES);
  } catch (error) {
    return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
      error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request' });
  if (body.action === 'request_quote') {
    return requestRequisitionQuote(sb, companyId, user, body);
  }
  const name = requisitionName(body.name);
  if (!name) return json(400, { error: 'invalid_requisition_name' });
  const qtyBySku = normalizeCartQuantities(body.cart);
  if (!qtyBySku || !Object.keys(qtyBySku).length) return json(400, { error: 'invalid_requisition_cart' });

  const priced = await priceRequisition(sb, request, env, qtyBySku);
  if (priced.error) return json(priced.error === 'server_error' ? 500 : 409, priced);
  const subtotal = priced.lines.reduce((sum, line) => sum + line.line_total, 0);
  const currency = priced.lines[0]?.currency || 'usd';
  const items = priced.lines.map(({ currency: _currency, ...line }) => line);
  const { data: id, error } = await sb.rpc('save_requisition', {
    p_company_id: companyId,
    p_user_id: user.id,
    p_name: name,
    p_items: items,
    p_subtotal: subtotal,
    p_currency: currency,
  });
  if (error) {
    const code = String(error.message || '').includes('too_many_requisitions')
      ? 'too_many_requisitions'
      : 'server_error';
    return json(code === 'too_many_requisitions' ? 409 : 500, { error: code });
  }
  if (!REQUISITION_ID.test(String(id || ''))) return json(500, { error: 'server_error' });
  return json(201, {
    requisition: {
      id,
      requisition_name: name,
      subtotal,
      total: subtotal,
      currency,
      order_items: items,
    },
  }, { 'cache-control': 'no-store' });
}

export async function onRequestDelete({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, user, sb } = ctx;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!REQUISITION_ID.test(id)) return json(400, { error: 'invalid_requisition_id' });
  const { quote, error: quoteError } = await findOpenRequisitionQuote(sb, id);
  if (quoteError) return json(500, { error: 'server_error' });
  if (quote) return json(409, { error: 'quote_in_progress' });
  const { data, error } = await sb.from('orders')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'cart')
    .not('requisition_name', 'is', null)
    .select('id')
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!data) return json(404, { error: 'not_found' });
  return json(200, { ok: true });
}

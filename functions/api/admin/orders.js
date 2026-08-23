// /api/admin/orders — staff order management.
//   GET ?status=&limit=         → orders across all companies
//   GET ?export=csv             → CSV download of (filtered) orders
//   POST explicit action        → guarded Order command; bare status writes rejected
//   POST { id, action:'refund' }→ queue one immutable refund command
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { netAging } from '../../_lib/credit.js';
import { escapeLike } from '../../_lib/crm.js';
import { decorateOrderLifecycle } from '../../_lib/order-lifecycle.js';
import { packingSlipHtml } from '../../_lib/packing-slip.js';
import { ORDER_STATUSES, runStaffOrderOperation } from '../../_lib/staff-order-operations.js';

/* Pseudo-status for fulfillment queue: lifecycle view, not column value. */
const NEEDS_FULFILLMENT = 'needs_fulfillment';

function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
const INTEGRATION_TIMELINE_SELECT = 'id,event_id,effect_type,status,attempt_count,last_error_code,provider_result,created_at,completed_at,dead_at';

export async function loadOrderIntegrationTimeline(sb, orderId, trackingNumber = null) {
  const queries = [
    sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .contains('payload', { order_id: orderId }).order('created_at', { ascending: false }).limit(50),
    sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .contains('provider_result', { order_id: orderId }).order('created_at', { ascending: false }).limit(50),
  ];
  if (trackingNumber) {
    queries.push(sb.from('integration_effects').select(INTEGRATION_TIMELINE_SELECT)
      .eq('aggregate_type', 'shipment').eq('aggregate_id', trackingNumber)
      .order('created_at', { ascending: false }).limit(50));
  }
  const responses = await Promise.all(queries);
  const failed = responses.find((response) => response.error);
  if (failed?.error) throw failed.error;
  const effects = [...new Map(responses
    .flatMap((response) => response.data || [])
    .map((effect) => [effect.id, effect])).values()]
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, 50);
  const eventIds = [...new Set(effects.map((effect) => effect.event_id).filter(Boolean))];
  let events = [];
  if (eventIds.length) {
    const response = await sb.from('integration_events')
      .select('id,provider,provider_event_type,occurred_at,received_at')
      .in('id', eventIds);
    if (response.error) throw response.error;
    events = response.data || [];
  }
  const eventById = new Map(events.map((event) => [event.id, event]));
  const resendIds = [...new Set(effects
    .map((effect) => effect.provider_result?.resend_id)
    .filter(Boolean))];
  let emailEvents = [];
  if (resendIds.length) {
    const response = await sb.from('email_events')
      .select('resend_id,status,updated_at,created_at')
      .in('resend_id', resendIds);
    if (response.error) throw response.error;
    emailEvents = response.data || [];
  }
  const emailByResendId = new Map();
  for (const emailEvent of emailEvents) {
    const current = emailByResendId.get(emailEvent.resend_id);
    const observedAt = emailEvent.updated_at || emailEvent.created_at || '';
    const currentAt = current?.updated_at || current?.created_at || '';
    if (!current || observedAt > currentAt) emailByResendId.set(emailEvent.resend_id, emailEvent);
  }
  return effects.map((effect) => ({
    id: effect.id,
    provider: eventById.get(effect.event_id)?.provider || 'unknown',
    event_type: eventById.get(effect.event_id)?.provider_event_type || null,
    effect_type: effect.effect_type,
    status: effect.status,
    attempt_count: effect.attempt_count,
    last_error_code: effect.last_error_code || null,
    result: effect.provider_result ? {
      applied: effect.provider_result.applied,
      skipped: effect.provider_result.skipped,
      resend_id: effect.provider_result.resend_id,
      email_status: emailByResendId.get(effect.provider_result.resend_id)?.status,
      email_updated_at: emailByResendId.get(effect.provider_result.resend_id)?.updated_at
        || emailByResendId.get(effect.provider_result.resend_id)?.created_at,
    } : null,
    created_at: effect.created_at,
    completed_at: effect.completed_at,
    dead_at: effect.dead_at,
  }));
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;

    // Buyer cancellation/return queue. Open requests are work that has a person waiting on
    // the other end, so they get their own listing rather than a per-order lookup.
    if (params.get('view') === 'requests') {
      const status = params.get('status') || 'open';
      let query = sb.from('order_requests')
        .select('id,order_id,type,status,reason,line_items,requested_email,resolution_note,created_at,resolved_at,orders(order_number,status,tracking_status,customer_email,total,currency,company_id)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return json(500, { error: error.message });
      return json(200, { requests: data || [] });
    }

    // Printable packing slip for the warehouse. Scoped to one shipment when a split key is
    // given, so a partial shipment is packed against its own document.
    if (params.get('format') === 'packing_slip' && params.get('id')) {
      const { data: order, error } = await sb.from('orders')
        .select('id,order_number,purchase_order_number,ship_address,carrier,tracking_number,order_items(sku,name,qty,backordered),order_shipments(split_key,item_allocations,status)')
        .eq('id', params.get('id')).single();
      if (error) return json(error.code === 'PGRST116' ? 404 : 500, { error: error.message });
      const splitKey = params.get('split_key');
      const shipment = splitKey
        ? (order.order_shipments || []).find((entry) => entry.split_key === splitKey) || null
        : null;
      return new Response(packingSlipHtml(order, {
        shipment,
        generatedAt: new Date().toISOString().slice(0, 10),
      }), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    // Per-order drill-down (#95): full detail + staff-action timeline for one order.
    const detailId = params.get('id');
    if (detailId) {
      const { data: order, error } = await sb.from('orders')
        .select('*,companies(name,net_terms_days,status),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered),shipment_events(status,carrier,tracking_number,note,created_at),order_provider_links(id,provider,object_type,provider_object_id,metadata,created_at),order_financial_entries(source,entry_type,provider_object_id,amount,currency,recognition_state,reason,metadata,created_at),order_shipments(id,split_key,generation,revision,provider_shipment_id,external_shipment_id,package_hash,status,operation,operation_state,selected_rate_id,item_allocations,error_code,updated_at,order_shipment_packages(sequence,package_code,weight_value,weight_unit,length_in,width_in,height_in,package_hash),order_shipment_rates(provider_rate_id,provider_shipment_id,shipment_revision,carrier_id,carrier_code,carrier_name,service_code,service_type,amount_minor,currency,currency_exponent,package_hash,delivery_days,estimated_delivery_at,selected,invalidated_at)),shipstation_operation_attempts(operation_key,operation,order_shipment_id,provider_link_id,parent_provider_link_id,provider_object_id,status,error_code,provider_succeeded_at,lease_expires_at,created_at),order_requests(id,type,status,reason,line_items,requested_email,resolution_note,created_at,resolved_at),order_reversal_commands(id,type,status,request_id,retirement_reason,retired_by_email,retired_at,created_at)')
        .eq('id', detailId).single();
      if (error) return json(error.code === 'PGRST116' ? 404 : 500, { error: error.message });
      const { data: timeline } = await sb.from('audit_log')
        .select('action,actor_email,detail,created_at')
        .eq('target_type', 'order').eq('target_id', detailId)
        .order('created_at', { ascending: false }).limit(50);
      let integrationTimeline;
      try {
        integrationTimeline = await loadOrderIntegrationTimeline(sb, detailId, order.tracking_number);
      } catch {
        return json(503, { error: 'order_integration_timeline_unavailable' });
      }
      const safeOrder = { ...order };
      delete safeOrder.shipstation_label_url;
      safeOrder.cancellation_review = (safeOrder.order_reversal_commands || [])
        .filter((command) => command.type === 'cancel' && command.status === 'review_required')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
      delete safeOrder.order_reversal_commands;
      return json(200, {
        order: decorateOrderLifecycle({ ...safeOrder, net_aging: netAging(order, order.companies?.net_terms_days) }),
        timeline: timeline || [],
        integration_timeline: integrationTimeline,
      });
    }

    const status = params.get('status');
    const isCsv = params.get('export') === 'csv';
    const { limit, offset } = parsePage(params, { defaultLimit: 100, maxLimit: 200 });
    let q = sb.from('orders')
      .select('id,order_number,status,payment_method,subtotal,shipping,tax,total,currency,purchase_order_number,refunded_amount,created_at,qbo_invoice_id,qbo_doc_id,qbo_doc_type,qbo_payment_id,qbo_intuit_tid,qbo_payment_intuit_tid,company_id,customer_email,ship_address,stripe_payment_intent,tracking_status,carrier,tracking_number,tracking_url,estimated_delivery_at,shipped_at,shipstation_shipment_id,shipstation_order_shipment_id,shipstation_shipment_revision,shipstation_package_hash,shipstation_shipment_state,shipstation_label_id,shipstation_rate_id,shipstation_carrier_id,shipstation_service_code,shipstation_cost,shipstation_label_status,shipstation_error,shipstation_updated_at,shipstation_return_label_id,shipstation_return_label_status,shipstation_return_cost,shipstation_return_currency,shipstation_return_charge_event,shipstation_return_tracking_number,shipstation_return_error,shipstation_return_updated_at,companies(name,net_terms_days),order_items(sku,product_sku,name,qty,unit_price,line_total,backordered),order_provider_links(id,provider,object_type,provider_object_id,metadata),order_financial_entries(source,entry_type,provider_object_id,recognition_state),order_shipments(id,split_key,generation,revision,status,operation_state,provider_shipment_id,external_shipment_id,package_hash,item_allocations,order_shipment_packages(sequence,package_code,weight_value,weight_unit,length_in,width_in,height_in,package_hash),order_shipment_rates(provider_rate_id,provider_shipment_id,shipment_revision,carrier_id,carrier_code,carrier_name,service_code,service_type,amount_minor,currency,currency_exponent,delivery_days,estimated_delivery_at,selected,invalidated_at)),shipstation_operation_attempts(operation_key,operation,order_shipment_id,provider_link_id,parent_provider_link_id,provider_object_id,status,error_code,provider_succeeded_at,lease_expires_at,created_at)', isCsv ? undefined : { count: 'exact' })
      .neq('status', 'cart').order('created_at', { ascending: false });
    q = isCsv ? q.limit(5000) : q.range(offset, offset + limit - 1);
    // "Needs fulfillment" is the queue the Overview counts, so the deep link from
    // that number has to select exactly the same rows: everything still owed a
    // shipment. Mirrors orderLifecycle().requires_fulfillment — open status, not
    // yet delivered — rather than any single status value.
    if (status === NEEDS_FULFILLMENT) {
      q = q.not('status', 'in', '(cart,cancelled,refunded,pending_payment)')
        .or('tracking_status.is.null,tracking_status.neq.delivered');
    } else if (status && ORDER_STATUSES.includes(status)) {
      q = q.eq('status', status);
    }
    // Server-side search so results aren't limited to the loaded page. Commas and
    // parens are stripped — they would break the PostgREST or= filter syntax.
    const search = String(params.get('search') || '').trim().replace(/[,()]/g, ' ').trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const ors = [`order_number.ilike.${like}`, `customer_email.ilike.${like}`, `tracking_number.ilike.${like}`];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) ors.push(`id.eq.${search}`);
      const { data: cos } = await sb.from('companies').select('id').ilike('name', like).limit(50);
      const coIds = (cos || []).map((c) => c.id).filter(Boolean);
      if (coIds.length) ors.push(`company_id.in.(${coIds.join(',')})`);
      q = q.or(ors.join(','));
    }
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });

    if (isCsv) {
      const rows = [['Order', 'Date', 'Company', 'Customer email', 'Purchase order', 'Status', 'Lifecycle', 'Next action', 'Payment', 'QBO doc', 'QBO payment', 'QBO TID', 'QBO payment TID', 'Tracking status', 'Carrier', 'Tracking #', 'ETA', 'Subtotal', 'Shipping', 'Tax', 'Total', 'Currency', 'Items']];
      for (const o of data || []) {
        const lifecycle = decorateOrderLifecycle(o).lifecycle;
        const items = (o.order_items || []).map((i) => `${i.qty}x ${i.name || i.sku}`).join('; ');
        rows.push([o.order_number || o.id, o.created_at, o.companies?.name || o.company_id || 'Guest', o.customer_email || '', o.purchase_order_number || '', o.status, lifecycle.label, lifecycle.next_action, o.payment_method || '', `${o.qbo_doc_type || ''} ${o.qbo_doc_id || o.qbo_invoice_id || ''}`.trim(), o.qbo_payment_id || '', o.qbo_intuit_tid || '', o.qbo_payment_intuit_tid || '',
          o.tracking_status || '', o.carrier || '', o.tracking_number || '', o.estimated_delivery_at || '',
          o.subtotal ?? '', o.shipping ?? '', o.tax ?? '', o.total ?? '', o.currency || '', items]);
      }
      return new Response(toCsv(rows), {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="masest-orders.csv"' },
      });
    }
    const orders = (data || []).map((o) => decorateOrderLifecycle({ ...o, net_aging: netAging(o, o.companies?.net_terms_days) }));
    return json(200, { orders, ...pageEnvelope(data, { limit, offset, count }) });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const result = await runStaffOrderOperation({ body, user, role, sb, env, request });
    return json(result.status, result.payload);
  }
  return json(405, { error: 'method_not_allowed' });
}

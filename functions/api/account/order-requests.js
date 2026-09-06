// POST /api/account/order-requests — buyer-initiated cancellation and return requests.
// GET  /api/account/order-requests — the caller's open/resolved requests.
//
// A request moves no money and cancels nothing. It records what the buyer wants, opens a
// staff queue entry, and lets the audited staff flow decide. That separation is deliberate:
// self-service reversal of an order that may already be on a truck is not a decision a
// browser session should be able to make.
import { adminClient, json, userFromRequest } from '../../_lib/supabase.js';
import { clientIp, rateLimit } from '../../_lib/ratelimit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';
import { orderLifecycle } from '../../_lib/order-lifecycle.js';
import { orderReference } from '../../_lib/order-integrations.js';
import {
  attemptSupportMessageDelivery,
  createSupportDeliveryWorkerId,
} from '../../_lib/support-delivery.js';
import { projectBuyerSupportTicket } from '../../_lib/support-tickets.js';

const BODY_MAX_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Returns stay open for a month after delivery: long enough for a buyer to open and test a
// drum, short enough that stock and the accounting period are still meaningful.
const RETURN_WINDOW_DAYS = 30;

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function projectBuyerOrderRequest(request = {}, ticketId = null) {
  return {
    id: request.id,
    order_id: request.order_id,
    ticket_id: ticketId,
    type: request.type,
    status: request.status,
    reason: request.reason,
    line_items: request.line_items,
    resolution_note: request.resolution_note,
    created_at: request.created_at,
    resolved_at: request.resolved_at,
    orders: request.orders,
  };
}

function projectBuyerSupportMessage(message = {}) {
  return {
    id: message.id,
    created_at: message.created_at,
    thread_id: message.thread_id,
    ticket_id: message.ticket_id,
    company_id: message.company_id,
    user_id: message.user_id,
    recipient_user_id: message.recipient_user_id,
    order_id: message.order_id,
    sender_role: message.sender_role,
    body: message.body,
    source: message.source,
    ticket: message.ticket ? projectBuyerSupportTicket(message.ticket) : null,
  };
}

// What the buyer may ask for, given where the order actually is. Exported so the dashboard
// renders the same two buttons the API will accept — no request that can only be rejected.
export function availableOrderRequests(order, { now = Date.now } = {}) {
  const status = text(order?.status, 40);
  if (['cancelled', 'refunded', 'cart'].includes(status)) return [];
  const lifecycle = orderLifecycle(order);
  const tracking = text(order?.tracking_status, 40);
  const options = [];
  // Cancellable until the parcel is moving. After that it is a return, not a cancellation.
  if (!['shipped', 'delivered'].includes(tracking) && lifecycle.stage !== 'complete') {
    options.push('cancel');
  }
  if (tracking === 'delivered' || status === 'fulfilled') {
    const shippedAt = Date.parse(order?.shipped_at || order?.updated_at || '');
    if (Number.isFinite(shippedAt) && (now() - shippedAt) <= RETURN_WINDOW_DAYS * 86400000) {
      options.push('return');
    }
  }
  return options;
}

async function ownedOrderQuery(sb, user, orderId, columns) {
  const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
  let query = sb.from('orders').select(columns).eq('id', orderId);
  query = profile?.company_id
    ? query.or(`user_id.eq.${user.id},company_id.eq.${profile.company_id}`)
    : query.eq('user_id', user.id);
  return query.maybeSingle();
}

export async function handleAccountOrderRequests({ request, env }, dependencies = {}) {
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBoundedJson || readBoundedJson;
  const getUser = dependencies.userFromRequest || userFromRequest;
  const getAdminClient = dependencies.adminClient || adminClient;
  const attemptDelivery = dependencies.attemptSupportMessageDelivery || attemptSupportMessageDelivery;
  const createDeliveryWorkerId = dependencies.createDeliveryWorkerId || createSupportDeliveryWorkerId;
  const now = dependencies.now || Date.now;

  const { user } = await getUser(request, env);
  if (!user) return json(401, { error: 'auth_required' });
  const sb = getAdminClient(env);

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  if (request.method === 'GET') {
    const { data, error } = await sb.from('order_requests')
      .select('id,order_id,ticket_id,type,status,reason,resolution_note,created_at,resolved_at,orders(order_number)')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return json(500, { error: 'server_error' });
    return json(200, { requests: data || [] });
  }

  const rl = await checkRateLimit(env, 'account-order-request', clientIp(request), { limit: 10, windowSec: 300 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  let body;
  try {
    body = await parseBody(request, BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json(413, { error: 'request_too_large' });
    return json(400, { error: 'bad_request' });
  }
  const orderId = text(body?.order_id, 80);
  const type = text(body?.type, 16);
  if (!UUID.test(orderId) || !['cancel', 'return'].includes(type)) {
    return json(400, { error: 'bad_request' });
  }
  const reason = text(body?.reason, 1000);
  if (reason.length < 8) {
    return json(400, { error: 'reason_required', message: 'Tell us briefly what went wrong so we can act on it.' });
  }

  const { data: order, error: orderError } = await ownedOrderQuery(
    sb, user, orderId,
    'id,order_number,user_id,company_id,status,tracking_status,shipped_at,updated_at,customer_email',
  );
  if (orderError) return json(500, { error: 'server_error' });
  if (!order) return json(404, { error: 'order_not_found' });

  const allowed = availableOrderRequests(order, { now });
  if (!allowed.includes(type)) {
    return json(409, {
      error: type === 'cancel' ? 'order_not_cancellable' : 'order_not_returnable',
      available: allowed,
    });
  }

  const messageBody = `${type === 'cancel' ? 'Cancellation' : 'Return'} requested for order ${orderReference(order)}: ${reason}`;
  const { data: result, error: requestError } = await sb.rpc('create_order_support_request', {
    p_order_id: order.id,
    p_type: type,
    p_reason: reason,
    p_line_items: Array.isArray(body?.lines) ? body.lines.slice(0, 50) : [],
    p_requested_by: user.id,
    p_requested_email: user.email || order.customer_email || null,
    p_message_body: messageBody,
    p_contract_version: 2,
  });
  if (requestError || !result?.request) return json(500, { error: 'server_error' });

  if (result.duplicate) {
    const exactTicketId = result.ticket_mapping_state === 'exact' ? result.ticket_id || null : null;
    return json(200, {
      ok: true,
      duplicate: true,
      request: projectBuyerOrderRequest(result.request, exactTicketId),
      ticket_id: exactTicketId,
      ticket: exactTicketId && result.ticket ? projectBuyerSupportTicket(result.ticket) : null,
      ticket_mapping_state: result.ticket_mapping_state || (exactTicketId ? 'exact' : 'unknown_legacy'),
      message: 'We already have this request and are working on it.',
    });
  }

  let emailDelivery = null;
  if (result.message) {
    try {
      emailDelivery = await attemptDelivery({
        env,
        sb,
        message: result.message,
        workerId: createDeliveryWorkerId('order-request'),
      });
    } catch {
      emailDelivery = {
        state: 'dead',
        effect_id: null,
        reason: 'support_delivery_status_unavailable',
      };
    }
  }

  return json(201, {
    ok: true,
    request: projectBuyerOrderRequest(result.request, result.ticket_id || result.message?.ticket_id || null),
    ticket_id: result.ticket_id || result.message?.ticket_id || null,
    ticket: result.ticket || result.message?.ticket
      ? projectBuyerSupportTicket(result.ticket || result.message.ticket)
      : null,
    support_message: result.message ? projectBuyerSupportMessage(result.message) : null,
    ticket_mapping_state: result.ticket_mapping_state || 'exact',
    email_delivery: emailDelivery,
    chat_linked: Boolean(result.chat_linked),
    message: type === 'cancel'
      ? 'Cancellation requested. We will confirm by email once it is processed.'
      : 'Return requested. We will email a prepaid return label once it is approved.',
  });
}

export function createAccountOrderRequestsHandler(dependencies = {}) {
  return (context) => handleAccountOrderRequests(context, dependencies);
}

// Authentication is resolved here, before anything else runs, and the result is handed to
// the handler so the request is never authenticated twice.
export async function onRequest(context) {
  const { request, env } = context;
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'auth_required' });
  return handleAccountOrderRequests(context, { userFromRequest: async () => ({ user }) });
}

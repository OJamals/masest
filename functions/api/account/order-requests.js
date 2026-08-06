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

const BODY_MAX_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Returns stay open for a month after delivery: long enough for a buyer to open and test a
// drum, short enough that stock and the accounting period are still meaningful.
const RETURN_WINDOW_DAYS = 30;

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
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
  const now = dependencies.now || Date.now;

  const { user } = await getUser(request, env);
  if (!user) return json(401, { error: 'auth_required' });
  const sb = getAdminClient(env);

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  if (request.method === 'GET') {
    const { data, error } = await sb.from('order_requests')
      .select('id,order_id,type,status,reason,resolution_note,created_at,resolved_at,orders(order_number)')
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

  const { data: created, error: insertError } = await sb.from('order_requests').insert({
    order_id: order.id,
    type,
    reason,
    line_items: Array.isArray(body?.lines) ? body.lines.slice(0, 50) : [],
    requested_by: user.id,
    requested_email: user.email || order.customer_email || null,
  }).select('id,order_id,type,status,created_at').maybeSingle();

  // The partial unique index turns a second open request of the same kind into a no-op
  // rather than a duplicate queue entry — re-submitting is idempotent for the buyer.
  if (insertError?.code === '23505') {
    return json(200, { ok: true, duplicate: true, message: 'We already have this request and are working on it.' });
  }
  if (insertError) return json(500, { error: 'server_error' });

  // Land it in the thread staff already watch, so it never waits in a queue nobody opens.
  await sb.from('messages').insert({
    company_id: order.company_id || null,
    user_id: user.id,
    order_id: order.id,
    direction: 'inbound',
    body: `${type === 'cancel' ? 'Cancellation' : 'Return'} requested for order ${orderReference(order)}: ${reason}`,
  }).then(() => {}, () => {});

  return json(201, {
    ok: true,
    request: created,
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

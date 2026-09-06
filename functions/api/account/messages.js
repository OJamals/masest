// /api/account/messages — the caller's participant chat plus any shared company chat.
//   GET → thread (marks staff msgs read by user unless ?peek=1) · POST { body } → buyer post
//   POST { action: 'chat_presence', chat_open } → authenticated buyer chat state
import { requireCommerceUser, json, readBody } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';
import { publishSupportMessage } from '../../_lib/support-message-publisher.js';
import {
  hydrateSupportOrderContexts,
  messagePage,
  resolveSupportOrderId,
  SUPPORT_PAGE_SIZE,
} from '../../_lib/support-messages.js';

async function visibleSupportThreadIds(sb, userId, companyId) {
  const [participantResult, companyResult] = await Promise.all([
    sb.from('support_threads').select('id').eq('participant_user_id', userId).maybeSingle(),
    companyId
      ? sb.from('support_threads').select('id')
        .eq('company_id', companyId).is('participant_user_id', null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (participantResult.error || companyResult.error) throw participantResult.error || companyResult.error;
  return [participantResult.data?.id, companyResult.data?.id].filter(Boolean);
}

export async function onRequest({ request, env }) {
  const ctx = await requireCommerceUser(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const peek = url.searchParams.get('peek') === '1';
    const before = url.searchParams.get('before');
    const orderContext = await resolveSupportOrderId(sb, {
      orderId: url.searchParams.get('order_id'),
      companyId,
      userId: user.id,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    let threadIds;
    try { threadIds = await visibleSupportThreadIds(sb, user.id, companyId); }
    catch { return json(500, { error: 'server_error' }); }
    if (!threadIds.length) {
      return json(200, {
        messages: [], has_more: false, next_before: null,
        order_scope: orderContext.order || null,
      });
    }
    let query = sb
      .from('messages')
      .select('id,thread_id,sender_role,body,order_id,source,created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false })
      .limit(SUPPORT_PAGE_SIZE + 1);
    if (orderContext.orderId) query = query.eq('order_id', orderContext.orderId);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query;
    if (error) return json(500, { error: 'server_error' });
    if (!peek) {
      let readQuery = sb.from('messages').update({ read_by_user: true })
        .in('thread_id', threadIds).eq('sender_role', 'staff').eq('read_by_user', false);
      if (orderContext.orderId) readQuery = readQuery.eq('order_id', orderContext.orderId);
      await readQuery;
    }
    try {
      const page = messagePage(data, SUPPORT_PAGE_SIZE);
      page.messages = await hydrateSupportOrderContexts(sb, page.messages);
      page.order_scope = orderContext.order || null;
      return json(200, page);
    } catch {
      return json(500, { error: 'server_error' });
    }
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body.action === 'chat_presence') {
      if (typeof body.chat_open !== 'boolean') return json(400, { error: 'chat_open_required' });
      const seenAt = body.chat_open ? new Date().toISOString() : null;
      const { error } = await sb.from('profiles').update({
        support_chat_open: body.chat_open,
        support_chat_seen_at: seenAt,
      })
        .eq('id', user.id);
      if (error) return json(500, { error: 'server_error' });
      return json(200, { support_chat_open: body.chat_open, support_chat_seen_at: seenAt });
    }

    // Throttle customer messages. The durable chat row remains canonical; its
    // counterpart email is delivered through the shared support-email module.
    const rl = await rateLimit(env, 'support-message', user.id || clientIp(request), { limit: 10, windowSec: 60 });
    if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const source = body.source === 'customer_chat' ? 'customer_chat' : 'dashboard';
    const orderContext = await resolveSupportOrderId(sb, {
      orderId: body.order_id,
      companyId,
      userId: user.id,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    let publication;
    try {
      publication = await publishSupportMessage({
        ...env,
        APP_URL: env.APP_URL || new URL(request.url).origin,
      }, sb, {
        companyId,
        userId: user.id,
        threadUserId: user.id,
        senderRole: 'buyer',
        body: text,
        orderId: orderContext.orderId,
        source,
      });
    } catch (error) {
      if (error?.code === 'durable_email_effects_not_ready') {
        return json(503, { error: 'durable_email_effects_not_ready', retryable: true });
      }
      return json(500, { error: 'server_error' });
    }
    const { message: data, emailDelivery } = publication;

    return json(201, {
      id: data.id,
      thread_id: data.thread_id,
      created_at: data.created_at,
      order_id: data.order_id || null,
      email_delivery: emailDelivery,
      summary_synced: true,
    });
  }

  return json(405, { error: 'method_not_allowed' });
}

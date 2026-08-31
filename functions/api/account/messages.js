// /api/account/messages — support thread between the caller's company and MASEST staff.
//   GET → thread (marks staff msgs read by user unless ?peek=1) · POST { body } → buyer post
//   POST { action: 'chat_presence', chat_open } → authenticated buyer chat state
import { requireCompany, json, readBody } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';
import { deliverSupportMessageEmail } from '../../_lib/support-email.js';
import {
  appendSupportMessage,
  hydrateSupportOrderContexts,
  messagePage,
  resolveSupportOrderId,
  SUPPORT_PAGE_SIZE,
} from '../../_lib/support-messages.js';

export async function onRequest({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const peek = url.searchParams.get('peek') === '1';
    const before = url.searchParams.get('before');
    const orderContext = await resolveSupportOrderId(sb, {
      orderId: url.searchParams.get('order_id'),
      companyId,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    let query = sb
      .from('messages')
      .select('id,sender_role,body,order_id,source,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(SUPPORT_PAGE_SIZE + 1);
    if (orderContext.orderId) query = query.eq('order_id', orderContext.orderId);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query;
    if (error) return json(500, { error: 'server_error' });
    if (!peek) {
      let readQuery = sb.from('messages').update({ read_by_user: true })
        .eq('company_id', companyId).eq('sender_role', 'staff').eq('read_by_user', false);
      if (orderContext.orderId) readQuery = readQuery.eq('order_id', orderContext.orderId);
      await readQuery;
    }
    try {
      const page = messagePage(data, SUPPORT_PAGE_SIZE);
      page.messages = await hydrateSupportOrderContexts(sb, page.messages, companyId);
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
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    let data;
    try {
      data = await appendSupportMessage(sb, {
        companyId,
        userId: user.id,
        senderRole: 'buyer',
        body: text,
        orderId: orderContext.orderId,
        source,
      });
    } catch {
      return json(500, { error: 'server_error' });
    }

    let emailDelivery;
    try {
      emailDelivery = await deliverSupportMessageEmail({ ...env, APP_URL: env.APP_URL || new URL(request.url).origin }, sb, data);
    } catch {
      emailDelivery = { ok: false, retryable: true, error: 'support_email_delivery_failed' };
    }

    return json(201, {
      id: data.id,
      created_at: data.created_at,
      order_id: data.order_id || null,
      email_delivery: emailDelivery,
      summary_synced: true,
    });
  }

  return json(405, { error: 'method_not_allowed' });
}

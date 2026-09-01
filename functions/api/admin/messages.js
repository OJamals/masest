// /api/admin/messages — staff side of company support threads.
//   GET → thread list · GET ?company_id= → full thread · PATCH → lifecycle · POST → reply
import { adminClient, requireStaff, json, readBody, emailsByIds, internalServerError } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { publishSupportMessage } from '../../_lib/support-message-publisher.js';
import {
  hydrateSupportOrderContexts,
  messagePage,
  resolveSupportOrderId,
  resolveSupportRecipient,
  SUPPORT_PAGE_SIZE,
  supportOrderContextsById,
  supportThreadListStatus,
  supportThreadPatch,
} from '../../_lib/support-messages.js';

async function hydrateSupportParticipants(sb, messages, companyId) {
  const ids = [...new Set((messages || []).map((message) => (
    message.sender_role === 'buyer' ? message.user_id : message.recipient_user_id
  )).filter(Boolean))];
  if (!ids.length) return messages || [];
  const { data, error } = await sb.from('profiles')
    .select('id,full_name')
    .in('id', ids)
    .eq('company_id', companyId);
  if (error) throw error;
  const emailById = await emailsByIds(sb, ids);
  const participantById = new Map((data || []).map((profile) => [profile.id, {
    id: profile.id,
    full_name: profile.full_name || null,
    email: emailById[profile.id] || null,
  }]));
  return (messages || []).map((message) => {
    const participantId = message.sender_role === 'buyer' ? message.user_id : message.recipient_user_id;
    return { ...message, participant: participantById.get(participantId) || null };
  });
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const companyId = params.get('company_id');
    if (companyId) {
      const before = params.get('before');
      const orderContext = await resolveSupportOrderId(sb, {
        orderId: params.get('order_id'),
        companyId,
      });
      if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
      let query = sb.from('messages')
        .select('id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(SUPPORT_PAGE_SIZE + 1);
      if (orderContext.orderId) query = query.eq('order_id', orderContext.orderId);
      if (before) query = query.lt('created_at', before);
      const { data, error } = await query;
      if (error) return internalServerError('admin.messages.thread_read', error);
      let readQuery = sb.from('messages').update({ read_by_staff: true })
        .eq('company_id', companyId).eq('sender_role', 'buyer').eq('read_by_staff', false);
      if (orderContext.orderId) readQuery = readQuery.eq('order_id', orderContext.orderId);
      await readQuery;
      const { data: company } = await sb.from('companies')
        .select('name,support_thread_status,support_thread_completed_at').eq('id', companyId).maybeSingle();
      let page;
      let orderScope = null;
      let orderParticipant = null;
      try {
        page = messagePage(data, SUPPORT_PAGE_SIZE);
        page.messages = await hydrateSupportOrderContexts(sb, page.messages, companyId);
        page.messages = await hydrateSupportParticipants(sb, page.messages, companyId);
        orderScope = orderContext.order || null;
        if (orderContext.orderId && !page.messages.at(-1)?.participant) {
          orderParticipant = await resolveSupportRecipient(sb, {
            companyId,
            userId: orderContext.recipientUserId,
            email: orderContext.recipientEmail,
          });
        }
      } catch (contextError) {
        return internalServerError('admin.messages.order_context', contextError);
      }
      return json(200, {
        ...page,
        thread: {
          company_id: companyId,
          company_name: company?.name || '—',
          status: company?.support_thread_status || 'open',
          completed_at: company?.support_thread_completed_at || null,
          order_scope: orderScope,
          participant: page.messages.at(-1)?.participant || (orderParticipant ? {
            id: orderParticipant.id,
            full_name: orderParticipant.full_name || null,
            email: orderParticipant.email || null,
          } : null),
        },
      });
    }
    if (params.get('summary') === '1') {
      const openThreads = sb.from('companies')
        .select('id', { count: 'exact', head: true })
        .not('support_last_message_at', 'is', null)
        .neq('support_thread_status', 'complete');
      const unansweredThreads = sb.from('companies')
        .select('id', { count: 'exact', head: true })
        .not('support_last_message_at', 'is', null)
        .neq('support_thread_status', 'complete')
        .eq('support_last_sender_role', 'buyer');
      const [openResult, unansweredResult] = await Promise.all([openThreads, unansweredThreads]);
      if (openResult.error) return internalServerError('admin.messages.summary_open', openResult.error);
      if (unansweredResult.error) return internalServerError('admin.messages.summary_unanswered', unansweredResult.error);
      return json(200, { summary: { open: openResult.count || 0, unanswered: unansweredResult.count || 0 } });
    }
    const listStatus = supportThreadListStatus(params.get('status'));
    if (!listStatus) return json(400, { error: 'invalid_status' });
    let query = sb.from('companies')
      .select('id,name,support_thread_status,support_thread_completed_at,support_last_message_at,support_last_message_body,support_last_sender_role,support_last_order_id')
      .not('support_last_message_at', 'is', null);
    query = listStatus === 'complete'
      ? query.eq('support_thread_status', 'complete')
      : query.neq('support_thread_status', 'complete');
    const { data, error } = await query
      .order('support_last_message_at', { ascending: false })
      .limit(500);
    if (error) return internalServerError('admin.messages.thread_list', error);
    let orderContexts;
    try {
      orderContexts = await supportOrderContextsById(sb, (data || []).map((company) => company.support_last_order_id));
    } catch (contextError) {
      return internalServerError('admin.messages.thread_order_context', contextError);
    }
    const threads = (data || []).map((company) => ({
      company_id: company.id,
      company_name: company.name || '—',
      last_body: company.support_last_message_body || '',
      last_at: company.support_last_message_at,
      status: company.support_thread_status || 'open',
      completed_at: company.support_thread_completed_at || null,
      unanswered: listStatus !== 'complete' && company.support_last_sender_role === 'buyer',
      order: company.support_last_order_id ? orderContexts.get(company.support_last_order_id) || null : null,
    }));
    return json(200, {
      threads,
      summary: listStatus === 'complete'
        ? { resolved: threads.length }
        : { open: threads.length, unanswered: threads.filter((thread) => thread.unanswered).length },
    });
  }

  if (request.method === 'PATCH') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const companyId = body.company_id;
    const status = body.status;
    if (!companyId) return json(400, { error: 'company_id_required' });
    const patch = supportThreadPatch(status, user.id);
    if (!patch) return json(400, { error: 'invalid_status' });
    const { error } = await sb.from('companies').update(patch).eq('id', companyId);
    if (error) return internalServerError('admin.messages.status_update', error);
    return json(200, { status });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const companyId = body.company_id;
    const text = String(body.body || '').trim();
    if (!companyId) return json(400, { error: 'company_id_required' });
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const orderContext = await resolveSupportOrderId(sb, {
      orderId: body.order_id,
      companyId,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    const explicitRecipientId = String(body.recipient_user_id || '').trim() || null;
    if (body.start_thread === true && !explicitRecipientId) {
      return json(400, { error: 'recipient_user_id_required' });
    }
    let lastMessageQuery = sb.from('messages')
      .select('sender_role,user_id,recipient_user_id').eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(1);
    if (orderContext.orderId) lastMessageQuery = lastMessageQuery.eq('order_id', orderContext.orderId);
    let { data: lastMessage, error: lastMessageError } = await lastMessageQuery.maybeSingle();
    if (lastMessageError) return internalServerError('admin.messages.recipient_context', lastMessageError);
    let recipientUserId = explicitRecipientId
      || (lastMessage?.sender_role === 'buyer' ? lastMessage.user_id : lastMessage?.recipient_user_id)
      || null;
    if (!recipientUserId && orderContext.orderId) {
      let orderRecipient;
      try {
        orderRecipient = await resolveSupportRecipient(sb, {
          companyId,
          userId: orderContext.recipientUserId,
          email: orderContext.recipientEmail,
        });
      } catch (recipientContextError) {
        return internalServerError('admin.messages.order_recipient', recipientContextError);
      }
      recipientUserId = orderRecipient?.id || null;
    }
    if (!recipientUserId && !explicitRecipientId) {
      const { data: latestBuyer, error: latestBuyerError } = await sb.from('messages')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('sender_role', 'buyer')
        .not('user_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestBuyerError) return internalServerError('admin.messages.recipient_fallback', latestBuyerError);
      recipientUserId = latestBuyer?.user_id || null;
    }
    if (!recipientUserId) return json(400, { error: 'recipient_user_id_required' });
    const { data: recipient, error: recipientError } = await sb.from('profiles')
      .select('id')
      .eq('id', recipientUserId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (recipientError) return internalServerError('admin.messages.recipient_read', recipientError);
    if (!recipient) return json(404, { error: 'recipient_not_found' });
    let publication;
    try {
      publication = await publishSupportMessage({
        ...env,
        APP_URL: env.APP_URL || new URL(request.url).origin,
      }, sb, {
        companyId,
        recipientUserId,
        senderRole: 'staff',
        body: text,
        orderId: orderContext.orderId,
        source: 'admin',
        reopen: body.start_thread === true,
      });
    } catch (error) {
      return internalServerError('admin.messages.reply_insert', error);
    }
    const { message: data, emailDelivery } = publication;
    const messageLink = orderContext.orderId
      ? `/dashboard.html?order=${encodeURIComponent(orderContext.orderId)}#messages`
      : '/dashboard.html#messages';
    await sb.from('notifications').insert({
      company_id: companyId, user_id: recipientUserId, type: 'message', title: 'New message from MASEST',
      body: text.slice(0, 140),
      link: messageLink,
    }).then(() => {}, () => {});
    return json(201, {
      id: data.id,
      created_at: data.created_at,
      order_id: data.order_id || null,
      recipient_user_id: data.recipient_user_id || recipientUserId,
      email_delivery: emailDelivery,
      summary_synced: true,
    });
  }

  return json(405, { error: 'method_not_allowed' });
}

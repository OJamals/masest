// /api/admin/messages — staff side of canonical participant/company support threads.
// GET → list · GET ?thread_id= (or legacy ?company_id=) → conversation
// PATCH → lifecycle · POST → first message/reply through the shared publisher.
import {
  adminClient,
  requireStaff,
  json,
  readBody,
  emailsByIds,
  internalServerError,
} from '../../_lib/supabase.js';
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

const THREAD_SELECT = 'id,participant_user_id,company_id,status,completed_at,completed_by,last_message_at,last_message_body,last_sender_role,last_order_id';

async function hydrateThreads(sb, rows, { includeEmails = false } = {}) {
  const threads = rows || [];
  const userIds = [...new Set(threads.map((thread) => thread.participant_user_id).filter(Boolean))];
  const companyIds = [...new Set(threads.map((thread) => thread.company_id).filter(Boolean))];
  const [profileResult, companyResult] = await Promise.all([
    userIds.length
      ? sb.from('profiles').select('id,full_name,company_id').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? sb.from('companies').select('id,name,status').in('id', companyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profileResult.error || companyResult.error) throw profileResult.error || companyResult.error;
  const emailById = includeEmails ? await emailsByIds(sb, userIds) : {};
  const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile]));
  const companies = new Map((companyResult.data || []).map((company) => [company.id, company]));
  return threads.map((thread) => {
    const profile = profiles.get(thread.participant_user_id) || null;
    const company = companies.get(thread.company_id) || null;
    return {
      ...thread,
      thread_id: thread.id,
      scope: thread.participant_user_id ? 'user' : 'company',
      participant: profile ? {
        id: profile.id,
        full_name: profile.full_name || null,
        email: emailById[profile.id] || null,
      } : null,
      company_name: company?.name || null,
      company_status: company?.status || null,
    };
  });
}

async function loadThread(sb, { threadId = null, companyId = null } = {}) {
  let query = sb.from('support_threads').select(THREAD_SELECT);
  if (threadId) query = query.eq('id', threadId);
  else if (companyId) query = query.eq('company_id', companyId).is('participant_user_id', null);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) return (await hydrateThreads(sb, [data], { includeEmails: true }))[0];
  if (!companyId || threadId) return null;
  const { data: company, error: companyError } = await sb.from('companies')
    .select('id,name,status').eq('id', companyId).maybeSingle();
  if (companyError) throw companyError;
  return company ? {
    id: null,
    thread_id: null,
    participant_user_id: null,
    company_id: company.id,
    company_name: company.name || null,
    company_status: company.status || null,
    scope: 'company',
    status: 'open',
    completed_at: null,
    participant: null,
  } : null;
}

function threadResponse(thread, order = null) {
  return {
    thread_id: thread.id || null,
    company_id: thread.company_id || null,
    company_name: thread.company_name || 'Customer',
    company_status: thread.company_status || null,
    participant_user_id: thread.participant_user_id || null,
    participant: thread.participant || null,
    scope: thread.scope,
    status: thread.status || 'open',
    completed_at: thread.completed_at || null,
    order_scope: order,
  };
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const threadId = String(params.get('thread_id') || '').trim() || null;
    const companyId = String(params.get('company_id') || '').trim() || null;
    if (threadId || companyId) {
      let thread;
      try { thread = await loadThread(sb, { threadId, companyId }); }
      catch (error) { return internalServerError('admin.messages.thread_context', error); }
      if (!thread) return json(404, { error: 'thread_not_found' });
      const before = params.get('before');
      const orderContext = await resolveSupportOrderId(sb, {
        orderId: params.get('order_id'),
        companyId: thread.company_id,
        userId: thread.participant_user_id,
      });
      if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });

      let rows = [];
      if (thread.id) {
        let query = sb.from('messages')
          .select('id,thread_id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references')
          .eq('thread_id', thread.id)
          .order('created_at', { ascending: false })
          .limit(SUPPORT_PAGE_SIZE + 1);
        if (orderContext.orderId) query = query.eq('order_id', orderContext.orderId);
        if (before) query = query.lt('created_at', before);
        const result = await query;
        if (result.error) return internalServerError('admin.messages.thread_read', result.error);
        rows = result.data || [];
        let readQuery = sb.from('messages').update({ read_by_staff: true })
          .eq('thread_id', thread.id).eq('sender_role', 'buyer').eq('read_by_staff', false);
        if (orderContext.orderId) readQuery = readQuery.eq('order_id', orderContext.orderId);
        await readQuery;
      }

      try {
        const page = messagePage(rows, SUPPORT_PAGE_SIZE);
        page.messages = await hydrateSupportOrderContexts(sb, page.messages);
        page.messages = page.messages.map((message) => ({ ...message, participant: thread.participant }));
        return json(200, {
          ...page,
          thread: threadResponse(thread, orderContext.order || null),
        });
      } catch (error) {
        return internalServerError('admin.messages.order_context', error);
      }
    }

    if (params.get('summary') === '1') {
      const openThreads = sb.from('support_threads')
        .select('id', { count: 'exact', head: true })
        .not('last_message_at', 'is', null)
        .neq('status', 'complete');
      const unansweredThreads = sb.from('support_threads')
        .select('id', { count: 'exact', head: true })
        .not('last_message_at', 'is', null)
        .neq('status', 'complete')
        .eq('last_sender_role', 'buyer');
      const [openResult, unansweredResult] = await Promise.all([openThreads, unansweredThreads]);
      if (openResult.error) return internalServerError('admin.messages.summary_open', openResult.error);
      if (unansweredResult.error) return internalServerError('admin.messages.summary_unanswered', unansweredResult.error);
      return json(200, { summary: { open: openResult.count || 0, unanswered: unansweredResult.count || 0 } });
    }

    const listStatus = supportThreadListStatus(params.get('status'));
    if (!listStatus) return json(400, { error: 'invalid_status' });
    let query = sb.from('support_threads')
      .select(THREAD_SELECT)
      .not('last_message_at', 'is', null);
    query = listStatus === 'complete' ? query.eq('status', 'complete') : query.neq('status', 'complete');
    const { data, error } = await query.order('last_message_at', { ascending: false }).limit(500);
    if (error) return internalServerError('admin.messages.thread_list', error);
    let hydrated;
    let orderContexts;
    try {
      hydrated = await hydrateThreads(sb, data || []);
      orderContexts = await supportOrderContextsById(sb, hydrated.map((thread) => thread.last_order_id));
    } catch (contextError) {
      return internalServerError('admin.messages.thread_context', contextError);
    }
    const threads = hydrated.map((thread) => ({
      thread_id: thread.id,
      company_id: thread.company_id || null,
      company_name: thread.company_name || null,
      participant_user_id: thread.participant_user_id || null,
      participant: thread.participant,
      scope: thread.scope,
      last_body: thread.last_message_body || '',
      last_at: thread.last_message_at,
      status: thread.status || 'open',
      completed_at: thread.completed_at || null,
      unanswered: listStatus !== 'complete' && thread.last_sender_role === 'buyer',
      order: thread.last_order_id ? orderContexts.get(thread.last_order_id) || null : null,
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
    let threadId = String(body.thread_id || '').trim() || null;
    if (!threadId && body.company_id) {
      try { threadId = (await loadThread(sb, { companyId: String(body.company_id) }))?.id || null; }
      catch (error) { return internalServerError('admin.messages.status_context', error); }
    }
    if (!threadId) return json(400, { error: 'thread_id_required' });
    const patch = supportThreadPatch(body.status, user.id);
    if (!patch) return json(400, { error: 'invalid_status' });
    const { data, error } = await sb.from('support_threads').update(patch)
      .eq('id', threadId).select('id,status').maybeSingle();
    if (error) return internalServerError('admin.messages.status_update', error);
    if (!data) return json(404, { error: 'thread_not_found' });
    return json(200, { thread_id: data.id, status: data.status });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const requestedThreadId = String(body.thread_id || '').trim() || null;
    const requestedCompanyId = String(body.company_id || '').trim() || null;
    const explicitRecipientId = String(body.recipient_user_id || '').trim() || null;
    if (body.start_thread === true && !explicitRecipientId) {
      return json(400, { error: 'recipient_user_id_required' });
    }

    let thread = null;
    if (requestedThreadId) {
      try { thread = await loadThread(sb, { threadId: requestedThreadId }); }
      catch (error) { return internalServerError('admin.messages.thread_context', error); }
      if (!thread) return json(404, { error: 'thread_not_found' });
    }

    let recipient = null;
    const recipientUserId = thread?.participant_user_id || explicitRecipientId || null;
    let companyId = thread?.company_id || requestedCompanyId || null;
    if (!recipientUserId) return json(400, { error: 'recipient_user_id_required' });
    try {
      recipient = await resolveSupportRecipient(sb, { companyId, userId: recipientUserId });
    } catch (error) {
      return internalServerError('admin.messages.recipient_read', error);
    }
    if (!recipient) return json(404, { error: 'recipient_not_found' });
    companyId = recipient.company_id || null;

    const orderContext = await resolveSupportOrderId(sb, {
      orderId: body.order_id,
      companyId,
      userId: recipientUserId,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });

    let publication;
    try {
      publication = await publishSupportMessage({
        ...env,
        APP_URL: env.APP_URL || new URL(request.url).origin,
      }, sb, {
        companyId,
        recipientUserId,
        threadUserId: recipientUserId,
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
    if (companyId && recipientUserId) {
      await sb.from('notifications').insert({
        company_id: companyId,
        user_id: recipientUserId,
        type: 'message',
        title: 'New message from MASEST',
        body: text.slice(0, 140),
        link: messageLink,
      }).then(() => {}, () => {});
    }
    return json(201, {
      id: data.id,
      thread_id: data.thread_id,
      created_at: data.created_at,
      order_id: data.order_id || null,
      recipient_user_id: data.recipient_user_id || recipientUserId,
      email_delivery: emailDelivery,
      summary_synced: true,
    });
  }

  return json(405, { error: 'method_not_allowed' });
}

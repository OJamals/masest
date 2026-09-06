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
} from '../../_lib/support-messages.js';
import {
  normalizeSupportTicketCategory,
  normalizeSupportTicketPriority,
  normalizeSupportTicketStatus,
  normalizeSupportTicketSubject,
  normalizeSupportTicketVersion,
  projectAdminSupportTicket,
  supportTicketById,
  supportTicketForThread,
  supportTicketLegacyStatus,
  supportTicketTransition,
  SUPPORT_TICKET_SELECT,
  updateSupportTicket,
} from '../../_lib/support-tickets.js';

// Thread fields are identity plus conversation-wide latest-message projections.
// Ticket status/version below is the only workflow authority during the UI transition.
const THREAD_SELECT = 'id,participant_user_id,company_id,last_message_at,last_message_body,last_sender_role,last_order_id';

function ticketListStatus(value) {
  const status = String(value || 'open').trim();
  return ['open', 'complete'].includes(status) ? status : null;
}

function currentTicketPerThread(rows) {
  const seen = new Set();
  return (rows || []).filter((ticket) => {
    if (!ticket?.thread_id || seen.has(ticket.thread_id)) return false;
    seen.add(ticket.thread_id);
    return true;
  });
}

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
    participant: null,
  } : null;
}

function threadResponse(thread, order = null, ticket = null) {
  const response = {
    thread_id: thread.id || null,
    company_id: thread.company_id || null,
    company_name: thread.company_name || 'Customer',
    company_status: thread.company_status || null,
    participant_user_id: thread.participant_user_id || null,
    participant: thread.participant || null,
    scope: thread.scope,
    status: ticket ? supportTicketLegacyStatus(ticket) : 'open',
    completed_at: ticket?.resolved_at || null,
    order_scope: order,
  };
  if (ticket) {
    response.ticket_id = ticket.id;
    response.ticket = projectAdminSupportTicket(ticket);
  }
  return response;
}

export async function handleAdminMessages({ request, env }, dependencies = {}) {
  const getStaffContext = dependencies.requireStaff || requireStaff;
  const getAdminClient = dependencies.adminClient || adminClient;
  const parseBody = dependencies.readBody || readBody;
  const publishMessage = dependencies.publishSupportMessage || publishSupportMessage;
  const findTicket = dependencies.supportTicketById || supportTicketById;
  const findThreadTicket = dependencies.supportTicketForThread || supportTicketForThread;
  const patchTicket = dependencies.updateSupportTicket || updateSupportTicket;
  const getThread = dependencies.loadThread || loadThread;
  const getRecipient = dependencies.resolveSupportRecipient || resolveSupportRecipient;

  const { user, staff, role } = await getStaffContext(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = getAdminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const threadId = String(params.get('thread_id') || '').trim() || null;
    const ticketId = String(params.get('ticket_id') || '').trim() || null;
    const companyId = String(params.get('company_id') || '').trim() || null;
    if (ticketId || threadId || companyId) {
      let ticket = null;
      let thread;
      try {
        if (ticketId) {
          ticket = await findTicket(sb, ticketId);
          if (!ticket) {
            return json(404, { error: 'ticket_not_found' });
          }
        }
        thread = await getThread(sb, {
          threadId: ticket?.thread_id || threadId,
          companyId: ticket ? null : companyId,
        });
        if (!ticket && thread?.id) ticket = await findThreadTicket(sb, thread.id);
      }
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
          .select('id,thread_id,ticket_id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references')
          .eq('thread_id', thread.id)
          .order('created_at', { ascending: false })
          .limit(SUPPORT_PAGE_SIZE + 1);
        if (ticketId) query = query.eq('ticket_id', ticket.id);
        if (orderContext.orderId) query = query.eq('order_id', orderContext.orderId);
        if (before) query = query.lt('created_at', before);
        const result = await query;
        if (result.error) return internalServerError('admin.messages.thread_read', result.error);
        rows = result.data || [];
        let readQuery = sb.from('messages').update({ read_by_staff: true })
          .eq('thread_id', thread.id)
          .eq('sender_role', 'buyer').eq('read_by_staff', false);
        if (ticketId) readQuery = readQuery.eq('ticket_id', ticket.id);
        if (orderContext.orderId) readQuery = readQuery.eq('order_id', orderContext.orderId);
        await readQuery;
      }

      try {
        const page = messagePage(rows, SUPPORT_PAGE_SIZE);
        page.messages = await hydrateSupportOrderContexts(sb, page.messages);
        page.messages = page.messages.map((message) => ({ ...message, participant: thread.participant }));
        return json(200, {
          ...page,
          thread: threadResponse(thread, orderContext.order || null, ticket),
        });
      } catch (error) {
        return internalServerError('admin.messages.order_context', error);
      }
    }

    if (params.get('summary') === '1') {
      const openTickets = sb.from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .not('last_message_at', 'is', null)
        .neq('status', 'resolved');
      const unansweredTickets = sb.from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .not('last_message_at', 'is', null)
        .neq('status', 'resolved')
        .eq('last_sender_role', 'buyer');
      const [openResult, unansweredResult] = await Promise.all([openTickets, unansweredTickets]);
      if (openResult.error) return internalServerError('admin.messages.summary_open', openResult.error);
      if (unansweredResult.error) return internalServerError('admin.messages.summary_unanswered', unansweredResult.error);
      return json(200, { summary: { open: openResult.count || 0, unanswered: unansweredResult.count || 0 } });
    }

    const listStatus = ticketListStatus(params.get('status'));
    if (!listStatus) return json(400, { error: 'invalid_status' });
    let query = sb.from('support_tickets')
      .select(SUPPORT_TICKET_SELECT)
      .not('last_message_at', 'is', null);
    query = listStatus === 'complete' ? query.eq('status', 'resolved') : query.neq('status', 'resolved');
    const { data, error } = await query.order('last_message_at', { ascending: false }).limit(500);
    if (error) return internalServerError('admin.messages.ticket_list', error);
    let hydrated;
    let orderContexts;
    try {
      const tickets = currentTicketPerThread(data || []).map(projectAdminSupportTicket);
      const threadIds = tickets.map((ticket) => ticket.thread_id);
      const threadResult = threadIds.length
        ? await sb.from('support_threads').select(THREAD_SELECT).in('id', threadIds)
        : { data: [], error: null };
      if (threadResult.error) throw threadResult.error;
      const threadsById = new Map(
        (await hydrateThreads(sb, threadResult.data || [])).map((thread) => [thread.id, thread]),
      );
      hydrated = tickets.map((ticket) => ({ ticket, thread: threadsById.get(ticket.thread_id) }))
        .filter((item) => item.thread);
      orderContexts = await supportOrderContextsById(
        sb,
        hydrated.map(({ ticket }) => ticket.primary_order_id),
      );
    } catch (contextError) {
      return internalServerError('admin.messages.thread_context', contextError);
    }
    const threads = hydrated.map(({ ticket, thread }) => ({
      thread_id: thread.id,
      ticket_id: ticket.id,
      ticket,
      company_id: thread.company_id || null,
      company_name: thread.company_name || null,
      participant_user_id: thread.participant_user_id || null,
      participant: thread.participant,
      scope: thread.scope,
      last_body: ticket.last_message_body || '',
      last_at: ticket.last_message_at,
      status: supportTicketLegacyStatus(ticket),
      completed_at: ticket.resolved_at || null,
      unanswered: listStatus !== 'complete' && ticket.last_sender_role === 'buyer',
      order: ticket.primary_order_id ? orderContexts.get(ticket.primary_order_id) || null : null,
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
    const body = await parseBody(request);
    const explicitTicketId = String(body.ticket_id || '').trim() || null;
    let transition;
    if (explicitTicketId) {
      const status = body.status === undefined ? null : normalizeSupportTicketStatus(body.status);
      const priority = body.priority === undefined ? null : normalizeSupportTicketPriority(body.priority);
      if (body.status !== undefined && !status) return json(400, { error: 'invalid_status' });
      if (body.priority !== undefined && !priority) return json(400, { error: 'invalid_priority' });
      if (!status && !priority) return json(400, { error: 'ticket_update_required' });
      transition = { status, priority };
    } else {
      transition = supportTicketTransition(body.status);
      if (!transition) return json(400, { error: 'invalid_status' });
    }
    let threadId = String(body.thread_id || '').trim() || null;
    if (!threadId && body.company_id) {
      try { threadId = (await getThread(sb, { companyId: String(body.company_id) }))?.id || null; }
      catch (error) { return internalServerError('admin.messages.status_context', error); }
    }
    if (!explicitTicketId && !threadId) return json(400, { error: 'thread_id_required' });

    let ticket;
    try {
      ticket = explicitTicketId
        ? await findTicket(sb, explicitTicketId)
        : await findThreadTicket(sb, threadId);
    } catch (error) {
      return internalServerError('admin.messages.status_context', error);
    }
    if (!ticket) {
      return json(404, { error: explicitTicketId ? 'ticket_not_found' : 'thread_not_found' });
    }
    const expectedVersion = explicitTicketId
      ? normalizeSupportTicketVersion(body.version)
      : ticket.version;
    if (!expectedVersion) return json(400, { error: 'ticket_version_required' });

    let updated;
    try {
      updated = await patchTicket(sb, {
        ticketId: ticket.id,
        expectedVersion,
        actorId: user.id,
        status: transition.status,
        priority: transition.priority,
      });
    } catch (error) {
      if (String(error?.message || '').includes('ticket_version_conflict')) {
        return json(409, { error: 'ticket_version_conflict' });
      }
      if (String(error?.message || '').includes('support_ticket_not_found')) {
        return json(404, { error: 'ticket_not_found' });
      }
      return internalServerError('admin.messages.status_update', error);
    }
    return json(200, {
      thread_id: updated.thread_id,
      ticket_id: updated.id,
      status: supportTicketLegacyStatus(updated),
      ticket: updated,
    });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await parseBody(request);
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const requestedThreadId = String(body.thread_id || '').trim() || null;
    const requestedTicketId = String(body.ticket_id || '').trim() || null;
    const requestedCompanyId = String(body.company_id || '').trim() || null;
    const explicitRecipientId = String(body.recipient_user_id || '').trim() || null;
    const legacyStartThread = body.start_thread === true;
    const startTicket = body.start_ticket === true
      || body.action === 'start_ticket';
    if ((legacyStartThread || startTicket)
      && !explicitRecipientId && !requestedThreadId && !requestedTicketId) {
      return json(400, { error: 'recipient_user_id_required' });
    }

    let ticket = null;
    let thread = null;
    if (requestedTicketId || requestedThreadId) {
      try {
        if (requestedTicketId) {
          ticket = await findTicket(sb, requestedTicketId);
          if (!ticket) {
            return json(404, { error: 'ticket_not_found' });
          }
        }
        thread = await getThread(sb, { threadId: ticket?.thread_id || requestedThreadId });
      }
      catch (error) { return internalServerError('admin.messages.thread_context', error); }
      if (!thread) return json(404, { error: 'thread_not_found' });
    }

    const companyWideTicket = Boolean(
      ticket && thread?.company_id && !thread.participant_user_id,
    );
    let recipient = null;
    const recipientUserId = companyWideTicket
      ? null
      : (thread?.participant_user_id || explicitRecipientId || null);
    let companyId = thread?.company_id || requestedCompanyId || null;
    if (!recipientUserId && !companyWideTicket) {
      return json(400, { error: 'recipient_user_id_required' });
    }
    if (recipientUserId) {
      try {
        recipient = await getRecipient(sb, { companyId, userId: recipientUserId });
      } catch (error) {
        return internalServerError('admin.messages.recipient_read', error);
      }
      if (!recipient) return json(404, { error: 'recipient_not_found' });
      companyId = recipient.company_id || null;
    }

    const orderContext = await resolveSupportOrderId(sb, {
      orderId: body.order_id,
      companyId,
      userId: recipientUserId,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    if (ticket?.primary_order_id && orderContext.orderId
      && ticket.primary_order_id !== orderContext.orderId) {
      return json(404, { error: 'ticket_not_found' });
    }
    const subject = normalizeSupportTicketSubject(
      body.subject,
      ticket?.subject || text,
    );
    if (!subject) return json(400, { error: 'invalid_ticket_subject' });
    const category = body.category === undefined
      ? (ticket?.category || 'general')
      : normalizeSupportTicketCategory(body.category);
    if (!category) return json(400, { error: 'invalid_ticket_category' });

    let publication;
    try {
      publication = await publishMessage({
        ...env,
        APP_URL: env.APP_URL || new URL(request.url).origin,
      }, sb, {
        companyId,
        recipientUserId,
        threadUserId: recipientUserId,
        threadId: thread?.id || null,
        ticketId: ticket?.id || null,
        senderRole: 'staff',
        body: text,
        orderId: orderContext.orderId,
        source: 'admin',
        reopen: legacyStartThread ? true : null,
        subject,
        category,
        startTicket,
      });
    } catch (error) {
      if (String(error?.message || '').includes('support_ticket_routing_not_enabled')) {
        return json(409, { error: 'support_ticket_routing_not_enabled' });
      }
      return internalServerError('admin.messages.reply_insert', error);
    }
    const { message: data, emailDelivery } = publication;
    const response = {
      id: data.id,
      thread_id: data.thread_id,
      created_at: data.created_at,
      order_id: data.order_id || null,
      recipient_user_id: data.recipient_user_id || recipientUserId,
      email_delivery: emailDelivery,
      summary_synced: true,
    };
    if (data.ticket_id) {
      response.ticket_id = data.ticket_id;
      response.ticket = data.ticket ? projectAdminSupportTicket(data.ticket) : null;
    }
    return json(201, response);
  }

  return json(405, { error: 'method_not_allowed' });
}

export function createAdminMessagesHandler(dependencies = {}) {
  return (context) => handleAdminMessages(context, dependencies);
}

export async function onRequest(context) {
  const { request, env } = context;
  const staffContext = await requireStaff(request, env);
  return handleAdminMessages(context, {
    requireStaff: async () => staffContext,
  });
}

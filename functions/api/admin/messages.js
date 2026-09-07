// /api/admin/messages — staff ticket queue, exact-ticket transcript and mutations.
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
} from '../../_lib/support-messages.js';
import {
  decodeSupportCursor,
  escapeSupportLike,
  listSupportAssignees,
  listSupportTickets,
  normalizeSupportTicketCategory,
  normalizeSupportTicketLimit,
  normalizeSupportTicketPriority,
  normalizeSupportTicketStatus,
  normalizeSupportTicketSubject,
  normalizeSupportTicketVersion,
  projectAdminSupportTicket,
  supportTicketById,
  SUPPORT_TICKET_QUEUES,
  updateSupportTicket,
} from '../../_lib/support-tickets.js';

const THREAD_SELECT = 'id,participant_user_id,company_id,last_message_at,last_message_body,last_sender_role,last_order_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_MAX = 120;

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

function threadResponse(thread, order = null) {
  return {
    thread_id: thread.id || null,
    company_id: thread.company_id || null,
    company_name: thread.company_name || 'Customer',
    company_status: thread.company_status || null,
    participant_user_id: thread.participant_user_id || null,
    participant: thread.participant || null,
    scope: thread.scope,
    order_scope: order,
  };
}

function invalidUuid(value) {
  return value !== null && value !== undefined && value !== '' && !UUID.test(String(value));
}

function hasUnexpectedParams(params, allowed) {
  return [...params.keys()].some((key) => !allowed.has(key));
}

function parseQueueParams(params, staffId) {
  const queue = String(params.get('queue') || 'needs_reply').trim();
  if (!SUPPORT_TICKET_QUEUES.includes(queue) || queue === 'active') return { error: 'invalid_queue' };
  const statusValue = params.get('status');
  const status = statusValue === null ? null : normalizeSupportTicketStatus(statusValue);
  if (statusValue !== null && !status) return { error: 'invalid_status' };
  const priorityValue = params.get('priority');
  const priority = priorityValue === null ? null : normalizeSupportTicketPriority(priorityValue);
  if (priorityValue !== null && !priority) return { error: 'invalid_priority' };
  const categoryValue = params.get('category');
  const category = categoryValue === null ? null : normalizeSupportTicketCategory(categoryValue);
  if (categoryValue !== null && !category) return { error: 'invalid_category' };
  const limit = normalizeSupportTicketLimit(params.get('limit'), 50);
  if (!limit) return { error: 'invalid_limit' };
  const cursor = String(params.get('cursor') || '').trim() || null;
  if (cursor && !decodeSupportCursor(cursor, { kind: 'ticket' })) return { error: 'invalid_cursor' };
  const companyId = String(params.get('company_id') || '').trim() || null;
  const orderId = String(params.get('order_id') || '').trim() || null;
  if (invalidUuid(companyId)) return { error: 'invalid_company_id' };
  if (invalidUuid(orderId)) return { error: 'invalid_order_id' };
  const rawSearch = String(params.get('search') || '').trim();
  if (rawSearch.length > SEARCH_MAX || /[\u0000-\u001f\u007f]/u.test(rawSearch)) return { error: 'invalid_search' };
  const rawAssignee = String(params.get('assignee') || '').trim() || null;
  let assigneeMode = null;
  let assigneeId = null;
  if (rawAssignee === 'mine') assigneeMode = 'mine';
  else if (rawAssignee === 'unassigned') assigneeMode = 'unassigned';
  else if (rawAssignee && UUID.test(rawAssignee)) {
    assigneeMode = 'staff';
    assigneeId = rawAssignee;
  } else if (rawAssignee) return { error: 'invalid_assignee' };
  return {
    queue,
    status,
    priority,
    category,
    limit,
    cursor,
    companyId,
    orderId,
    search: rawSearch ? escapeSupportLike(rawSearch) : null,
    assigneeMode,
    assigneeId,
    staffId,
  };
}

function messageCursorFilter(cursor) {
  return `created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${cursor.id})`;
}

export async function handleAdminMessages({ request, env }, dependencies = {}) {
  const getStaffContext = dependencies.requireStaff || requireStaff;
  const getAdminClient = dependencies.adminClient || adminClient;
  const parseBody = dependencies.readBody || readBody;
  const publishMessage = dependencies.publishSupportMessage || publishSupportMessage;
  const findTicket = dependencies.supportTicketById || supportTicketById;
  const patchTicket = dependencies.updateSupportTicket || updateSupportTicket;
  const getThread = dependencies.loadThread || loadThread;
  const getRecipient = dependencies.resolveSupportRecipient || resolveSupportRecipient;
  const listTickets = dependencies.listSupportTickets || listSupportTickets;
  const listAssignees = dependencies.listSupportAssignees || listSupportAssignees;

  const { user, staff, role } = await getStaffContext(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = getAdminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const view = String(params.get('view') || '').trim() || null;
    const ticketId = String(params.get('ticket_id') || '').trim() || null;
    const summaryOnly = params.get('summary') === '1';
    const modeCount = Number(Boolean(view)) + Number(Boolean(ticketId)) + Number(summaryOnly);
    if (modeCount > 1) return json(400, { error: 'invalid_query_mode' });

    if (view) {
      if (view !== 'assignees' || hasUnexpectedParams(params, new Set(['view']))) {
        return json(400, { error: 'invalid_view' });
      }
      try {
        return json(200, { assignees: await listAssignees(sb) });
      } catch (error) {
        return internalServerError('admin.messages.assignees', error);
      }
    }

    if (ticketId) {
      const allowed = new Set(['ticket_id', 'message_cursor', 'limit', 'order_id', 'peek']);
      if (!UUID.test(ticketId) || hasUnexpectedParams(params, allowed)) {
        return json(400, { error: 'invalid_ticket_query' });
      }
      const limit = normalizeSupportTicketLimit(params.get('limit'), 100);
      const cursorValue = String(params.get('message_cursor') || '').trim() || null;
      const cursor = cursorValue ? decodeSupportCursor(cursorValue, { kind: 'message' }) : null;
      if (!limit) return json(400, { error: 'invalid_limit' });
      if (cursorValue && !cursor) return json(400, { error: 'invalid_message_cursor' });
      let ticket;
      let thread;
      try {
        ticket = await findTicket(sb, ticketId);
        if (!ticket) return json(404, { error: 'ticket_not_found' });
        thread = await getThread(sb, { threadId: ticket.thread_id });
      } catch (error) {
        return internalServerError('admin.messages.ticket_context', error);
      }
      if (!thread) return json(404, { error: 'ticket_not_found' });
      const orderContext = await resolveSupportOrderId(sb, {
        orderId: params.get('order_id'),
        companyId: thread.company_id,
        userId: thread.participant_user_id,
      });
      if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
      let query = sb.from('messages')
        .select('id,thread_id,ticket_id,sender_role,user_id,recipient_user_id,body,order_id,created_at,read_by_staff,source,external_message_id,email_delivery_id,email_message_id,email_references')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (cursor) query = query.or(messageCursorFilter(cursor));
      const result = await query;
      if (result.error) return internalServerError('admin.messages.ticket_read', result.error);
      if (params.get('peek') !== '1') {
        await sb.from('messages').update({ read_by_staff: true })
          .eq('ticket_id', ticket.id).eq('sender_role', 'buyer').eq('read_by_staff', false);
      }
      try {
        const page = messagePage(result.data || [], limit);
        page.messages = await hydrateSupportOrderContexts(sb, page.messages);
        return json(200, {
          ticket: projectAdminSupportTicket(ticket),
          thread: threadResponse(thread, orderContext.order || null),
          ...page,
          order_scope: orderContext.order || null,
        });
      } catch (error) {
        return internalServerError('admin.messages.order_context', error);
      }
    }

    const allowed = new Set([
      'summary', 'queue', 'status', 'assignee', 'priority', 'category', 'search',
      'company_id', 'order_id', 'limit', 'cursor',
    ]);
    if (hasUnexpectedParams(params, allowed)) return json(400, { error: 'invalid_queue_query' });
    const listParams = parseQueueParams(params, user.id);
    if (listParams.error) return json(400, { error: listParams.error });
    try {
      const page = await listTickets(sb, { ...listParams, projection: 'admin' });
      return summaryOnly ? json(200, { summary: page.summary }) : json(200, page);
    } catch (error) {
      if (String(error?.message || '').includes('invalid_ticket_cursor')) {
        return json(400, { error: 'invalid_cursor' });
      }
      return internalServerError('admin.messages.ticket_list', error);
    }
  }

  if (request.method === 'PATCH') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await parseBody(request);
    const ticketId = String(body.ticket_id || '').trim();
    const expectedVersion = normalizeSupportTicketVersion(body.version);
    if (!UUID.test(ticketId)) return json(400, { error: 'ticket_id_required' });
    if (!expectedVersion) return json(400, { error: 'ticket_version_required' });
    const status = body.status === undefined ? null : normalizeSupportTicketStatus(body.status);
    const priority = body.priority === undefined ? null : normalizeSupportTicketPriority(body.priority);
    const category = body.category === undefined ? null : normalizeSupportTicketCategory(body.category);
    const assignmentProvided = Object.hasOwn(body, 'assigned_to');
    const assignedTo = assignmentProvided && body.assigned_to !== null
      ? String(body.assigned_to || '').trim()
      : null;
    if (body.status !== undefined && !status) return json(400, { error: 'invalid_status' });
    if (body.priority !== undefined && !priority) return json(400, { error: 'invalid_priority' });
    if (body.category !== undefined && !category) return json(400, { error: 'invalid_category' });
    if (assignmentProvided && assignedTo !== null && !UUID.test(assignedTo)) {
      return json(400, { error: 'invalid_assignee' });
    }
    if (status === null && priority === null && category === null && !assignmentProvided) {
      return json(400, { error: 'ticket_update_required' });
    }
    try {
      const ticket = await patchTicket(sb, {
        ticketId,
        expectedVersion,
        actorId: user.id,
        status,
        priority,
        category,
        assignedTo,
        assignmentProvided,
      });
      return json(200, { ticket_id: ticket.id, ticket });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('ticket_version_conflict')) return json(409, { error: 'ticket_version_conflict' });
      if (message.includes('support_ticket_not_found')) return json(404, { error: 'ticket_not_found' });
      if (message.includes('support_ticket_assignee_ineligible')) return json(400, { error: 'invalid_assignee' });
      return internalServerError('admin.messages.ticket_update', error);
    }
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await parseBody(request);
    const action = String(body.action || '').trim();
    if (!['reply', 'start_ticket'].includes(action)) return json(400, { error: 'invalid_action' });
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const requestedTicketId = String(body.ticket_id || '').trim() || null;
    if (action === 'start_ticket' && (requestedTicketId || body.thread_id || body.start_thread)) {
      return json(400, { error: 'invalid_ticket_action' });
    }

    let ticket = null;
    let thread = null;
    let recipient = null;
    let recipientUserId = null;
    let companyId = null;
    let expectedTicketVersion = null;
    if (action === 'reply') {
      expectedTicketVersion = normalizeSupportTicketVersion(body.version);
      if (!requestedTicketId || !UUID.test(requestedTicketId)) return json(400, { error: 'ticket_id_required' });
      if (!expectedTicketVersion) return json(400, { error: 'ticket_version_required' });
      try {
        ticket = await findTicket(sb, requestedTicketId);
        if (!ticket) return json(404, { error: 'ticket_not_found' });
        thread = await getThread(sb, { threadId: ticket.thread_id });
      } catch (error) {
        return internalServerError('admin.messages.ticket_context', error);
      }
      if (!thread) return json(404, { error: 'ticket_not_found' });
      recipientUserId = thread.participant_user_id || null;
      companyId = thread.company_id || null;
    } else {
      recipientUserId = String(body.recipient_user_id || '').trim();
      if (!UUID.test(recipientUserId)) return json(400, { error: 'recipient_user_id_required' });
      try {
        recipient = await getRecipient(sb, { userId: recipientUserId });
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
    const subject = action === 'start_ticket'
      ? normalizeSupportTicketSubject(body.subject, text)
      : ticket.subject;
    if (!subject) return json(400, { error: 'invalid_ticket_subject' });
    const category = action === 'start_ticket'
      ? normalizeSupportTicketCategory(body.category === undefined ? 'general' : body.category)
      : ticket.category;
    if (!category) return json(400, { error: 'invalid_ticket_category' });

    try {
      const publication = await publishMessage({
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
        subject,
        category,
        startTicket: action === 'start_ticket',
        expectedTicketVersion,
      });
      const { message: data, emailDelivery } = publication;
      return json(201, {
        id: data.id,
        thread_id: data.thread_id,
        ticket_id: data.ticket_id,
        ticket: data.ticket ? projectAdminSupportTicket(data.ticket) : null,
        created_at: data.created_at,
        order_id: data.order_id || null,
        recipient_user_id: data.recipient_user_id || recipientUserId,
        email_delivery: emailDelivery,
        summary_synced: true,
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('support_ticket_routing_not_enabled')) {
        return json(409, { error: 'support_ticket_routing_not_enabled' });
      }
      if (message.includes('ticket_version_conflict')) return json(409, { error: 'ticket_version_conflict' });
      if (message.includes('support_ticket_reply_resolved')) return json(409, { error: 'ticket_resolved' });
      return internalServerError('admin.messages.reply_insert', error);
    }
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

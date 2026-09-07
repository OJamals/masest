// /api/account/messages — buyer active ticket, history, activity and exact replies.
import { requireCommerceUser, json, readBody } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';
import { publishSupportMessage } from '../../_lib/support-message-publisher.js';
import {
  hydrateSupportOrderContexts,
  messagePage,
  resolveSupportOrderId,
} from '../../_lib/support-messages.js';
import {
  decodeSupportCursor,
  listSupportTickets,
  normalizeSupportTicketCategory,
  normalizeSupportTicketLimit,
  normalizeSupportTicketSubject,
  projectBuyerSupportTicket,
  supportTicketById,
  SUPPORT_TICKET_SELECT,
} from '../../_lib/support-tickets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_SELECT = 'id,thread_id,ticket_id,sender_role,body,order_id,source,created_at';

async function visibleSupportThreadScope(sb, userId, companyId) {
  const [participantResult, companyResult] = await Promise.all([
    sb.from('support_threads').select('id').eq('participant_user_id', userId).maybeSingle(),
    companyId
      ? sb.from('support_threads').select('id')
        .eq('company_id', companyId).is('participant_user_id', null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (participantResult.error || companyResult.error) throw participantResult.error || companyResult.error;
  const participantThreadId = participantResult.data?.id || null;
  const companyThreadId = companyResult.data?.id || null;
  return {
    participantThreadId,
    companyThreadId,
    threadIds: [participantThreadId, companyThreadId].filter(Boolean),
  };
}

function messageCursorFilter(cursor) {
  return `created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${cursor.id})`;
}

function hasUnexpectedParams(params, allowed) {
  return [...params.keys()].some((key) => !allowed.has(key));
}

function projectVisibleBuyerTicket(ticket, scope) {
  if (!ticket) return null;
  return projectBuyerSupportTicket({
    ...ticket,
    scope: ticket.thread_id === scope?.companyThreadId ? 'company' : 'personal',
  });
}

async function buyerActivity(sb, scope) {
  if (!scope.threadIds.length) return [];
  const messageResult = await sb.from('messages')
    .select(MESSAGE_SELECT)
    .in('thread_id', scope.threadIds)
    .not('ticket_id', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(6);
  if (messageResult.error) throw messageResult.error;
  const messages = messageResult.data || [];
  const ticketIds = [...new Set(messages.map((message) => message.ticket_id).filter(Boolean))];
  const ticketResult = ticketIds.length
    ? await sb.from('support_tickets').select(SUPPORT_TICKET_SELECT).in('id', ticketIds)
    : { data: [], error: null };
  if (ticketResult.error) throw ticketResult.error;
  const tickets = new Map((ticketResult.data || []).map((ticket) => [ticket.id, projectBuyerSupportTicket({
    ...ticket,
    scope: ticket.thread_id === scope.companyThreadId ? 'company' : 'personal',
  })]));
  const hydrated = await hydrateSupportOrderContexts(sb, messages);
  return hydrated.flatMap((message) => {
    const ticket = tickets.get(message.ticket_id);
    return ticket ? [{ ...message, ticket }] : [];
  });
}

export async function handleAccountMessages({ request, env }, dependencies = {}) {
  const getCommerceContext = dependencies.requireCommerceUser || requireCommerceUser;
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const parseBody = dependencies.readBody || readBody;
  const publishMessage = dependencies.publishSupportMessage || publishSupportMessage;
  const findTicket = dependencies.supportTicketById || supportTicketById;
  const listTickets = dependencies.listSupportTickets || listSupportTickets;
  const listVisibleScope = dependencies.visibleSupportThreadScope || visibleSupportThreadScope;
  const loadActivity = dependencies.buyerActivity || buyerActivity;
  const resolveOrder = dependencies.resolveSupportOrderId || resolveSupportOrderId;
  const now = dependencies.now || (() => new Date());

  const ctx = await getCommerceContext(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const view = String(params.get('view') || '').trim() || null;
    const requestedTicketId = String(params.get('ticket_id') || '').trim() || null;
    if (view && requestedTicketId) return json(400, { error: 'invalid_query_mode' });
    if (view && !['tickets', 'activity'].includes(view)) return json(400, { error: 'invalid_view' });
    if (requestedTicketId && !UUID.test(requestedTicketId)) return json(400, { error: 'invalid_ticket_id' });
    const allowed = view === 'tickets'
      ? new Set(['view', 'ticket_cursor', 'limit', 'order_id'])
      : view === 'activity'
        ? new Set(['view', 'peek'])
        : new Set(['ticket_id', 'message_cursor', 'limit', 'order_id', 'peek']);
    if (hasUnexpectedParams(params, allowed)) return json(400, { error: 'invalid_query' });

    let scope;
    try {
      scope = await listVisibleScope(sb, user.id, companyId);
    } catch {
      return json(500, { error: 'server_error' });
    }

    if (view === 'activity') {
      if (params.get('peek') !== '1') return json(400, { error: 'peek_required' });
      try {
        return json(200, { messages: await loadActivity(sb, scope) });
      } catch {
        return json(500, { error: 'server_error' });
      }
    }

    if (view === 'tickets') {
      const limit = normalizeSupportTicketLimit(params.get('limit'), 20);
      const cursor = String(params.get('ticket_cursor') || '').trim() || null;
      if (!limit) return json(400, { error: 'invalid_limit' });
      if (cursor && !decodeSupportCursor(cursor, { kind: 'ticket' })) {
        return json(400, { error: 'invalid_ticket_cursor' });
      }
      const historyOrderContext = await resolveOrder(sb, {
        orderId: params.get('order_id'),
        companyId,
        userId: user.id,
      });
      if (!historyOrderContext.ok) {
        return json(historyOrderContext.status, { error: historyOrderContext.error });
      }
      try {
        const page = await listTickets(sb, {
          queue: 'all',
          threadIds: scope.threadIds,
          orderId: historyOrderContext.orderId,
          cursor,
          limit,
          projection: 'buyer',
        });
        return json(200, {
          tickets: page.tickets,
          has_more: page.has_more,
          next_ticket_cursor: page.next_cursor,
        });
      } catch (error) {
        if (String(error?.message || '').includes('invalid_ticket_cursor')) {
          return json(400, { error: 'invalid_ticket_cursor' });
        }
        return json(500, { error: 'server_error' });
      }
    }

    const orderContext = await resolveOrder(sb, {
      orderId: params.get('order_id'),
      companyId,
      userId: user.id,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });
    const limit = normalizeSupportTicketLimit(params.get('limit'), 100);
    const cursorValue = String(params.get('message_cursor') || '').trim() || null;
    const cursor = cursorValue ? decodeSupportCursor(cursorValue, { kind: 'message' }) : null;
    if (!limit) return json(400, { error: 'invalid_limit' });
    if (cursorValue && !cursor) return json(400, { error: 'invalid_message_cursor' });

    let selectedTicket = null;
    try {
      if (requestedTicketId) {
        selectedTicket = await findTicket(sb, requestedTicketId);
        if (!selectedTicket || !scope.threadIds.includes(selectedTicket.thread_id)) {
          return json(404, { error: 'ticket_not_found' });
        }
      } else if (scope.participantThreadId) {
        const active = await listTickets(sb, {
          queue: 'active',
          threadIds: [scope.participantThreadId],
          orderId: orderContext.orderId,
          limit: 1,
          projection: 'buyer',
        });
        selectedTicket = active.tickets[0] || null;
      }
    } catch {
      return json(500, { error: 'server_error' });
    }
    if (selectedTicket?.primary_order_id && orderContext.orderId
      && selectedTicket.primary_order_id !== orderContext.orderId) {
      return json(404, { error: 'ticket_not_found' });
    }
    if (!selectedTicket) {
      return json(200, {
        ticket: null,
        messages: [],
        has_more: false,
        next_message_cursor: null,
        order_scope: orderContext.order || null,
      });
    }

    let query = sb.from('messages')
      .select(MESSAGE_SELECT)
      .eq('ticket_id', selectedTicket.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (cursor) query = query.or(messageCursorFilter(cursor));
    const result = await query;
    if (result.error) return json(500, { error: 'server_error' });
    if (params.get('peek') !== '1') {
      await sb.from('messages').update({ read_by_user: true })
        .eq('ticket_id', selectedTicket.id).eq('sender_role', 'staff').eq('read_by_user', false);
    }
    try {
      const page = messagePage(result.data || [], limit);
      page.messages = await hydrateSupportOrderContexts(sb, page.messages);
      return json(200, {
        ticket: projectVisibleBuyerTicket(selectedTicket, scope),
        ...page,
        order_scope: orderContext.order || null,
      });
    } catch {
      return json(500, { error: 'server_error' });
    }
  }

  if (request.method === 'POST') {
    const body = await parseBody(request);
    if (body.action === 'chat_presence') {
      if (typeof body.chat_open !== 'boolean') return json(400, { error: 'chat_open_required' });
      const seenAt = body.chat_open ? now().toISOString() : null;
      const { error } = await sb.from('profiles').update({
        support_chat_open: body.chat_open,
        support_chat_seen_at: seenAt,
      }).eq('id', user.id);
      if (error) return json(500, { error: 'server_error' });
      return json(200, { support_chat_open: body.chat_open, support_chat_seen_at: seenAt });
    }

    const rl = await checkRateLimit(env, 'support-message', user.id || clientIp(request), { limit: 10, windowSec: 60 });
    if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
    const text = String(body.body || '').trim();
    if (!text) return json(400, { error: 'empty_message' });
    if (text.length > 4000) return json(400, { error: 'message_too_long' });
    const action = body.action === undefined ? null : String(body.action || '').trim();
    if (action && !['reply', 'start_ticket'].includes(action)) return json(400, { error: 'invalid_action' });
    const ticketId = String(body.ticket_id || '').trim() || null;
    const startTicket = action === 'start_ticket';
    if (startTicket && ticketId) return json(400, { error: 'invalid_ticket_action' });
    if (action === 'reply' && !ticketId) return json(400, { error: 'ticket_id_required' });
    if (ticketId && !UUID.test(ticketId)) return json(400, { error: 'invalid_ticket_id' });
    const source = body.source === 'customer_chat' ? 'customer_chat' : 'dashboard';
    let subject = normalizeSupportTicketSubject(body.subject, text);
    if (!subject) return json(400, { error: 'invalid_ticket_subject' });
    let category = body.category === undefined ? 'general' : normalizeSupportTicketCategory(body.category);
    if (!category) return json(400, { error: 'invalid_ticket_category' });
    const orderContext = await resolveOrder(sb, {
      orderId: body.order_id,
      companyId,
      userId: user.id,
    });
    if (!orderContext.ok) return json(orderContext.status, { error: orderContext.error });

    let selectedTicket = null;
    let visibleScope = null;
    if (ticketId) {
      try {
        [selectedTicket, visibleScope] = await Promise.all([
          findTicket(sb, ticketId),
          listVisibleScope(sb, user.id, companyId),
        ]);
      } catch {
        return json(500, { error: 'server_error' });
      }
      if (!selectedTicket || !visibleScope.threadIds.includes(selectedTicket.thread_id)) {
        return json(404, { error: 'ticket_not_found' });
      }
      if (orderContext.orderId && selectedTicket.primary_order_id
        && selectedTicket.primary_order_id !== orderContext.orderId) {
        return json(404, { error: 'ticket_not_found' });
      }
      // Exact replies retain the ticket's durable metadata; buyer input cannot edit it.
      subject = selectedTicket.subject;
      category = selectedTicket.category;
    }

    try {
      const publication = await publishMessage({
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
        ticketId,
        threadId: selectedTicket?.thread_id || null,
        subject,
        category,
        startTicket,
      });
      const { message: data, emailDelivery } = publication;
      return json(201, {
        id: data.id,
        thread_id: data.thread_id,
        ticket_id: data.ticket_id,
        ticket: data.ticket ? projectVisibleBuyerTicket(data.ticket, visibleScope) : null,
        created_at: data.created_at,
        order_id: data.order_id || null,
        email_delivery: emailDelivery,
        summary_synced: true,
      });
    } catch (error) {
      if (String(error?.message || '').includes('support_ticket_routing_not_enabled')) {
        return json(409, { error: 'support_ticket_routing_not_enabled' });
      }
      return json(500, { error: 'server_error' });
    }
  }

  return json(405, { error: 'method_not_allowed' });
}

export function createAccountMessagesHandler(dependencies = {}) {
  return (context) => handleAccountMessages(context, dependencies);
}

export async function onRequest(context) {
  const { request, env } = context;
  const commerceContext = await requireCommerceUser(request, env);
  return handleAccountMessages(context, {
    requireCommerceUser: async () => commerceContext,
  });
}

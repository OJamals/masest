export const SUPPORT_TICKET_STATUSES = Object.freeze([
  'open',
  'waiting_on_customer',
  'resolved',
]);

export const SUPPORT_TICKET_PRIORITIES = Object.freeze([
  'normal',
  'high',
  'urgent',
]);

export const SUPPORT_TICKET_CATEGORIES = Object.freeze([
  'general',
  'product',
  'order',
  'shipping',
  'billing',
  'account',
  'technical',
]);

export const SUPPORT_TICKET_SELECT = [
  'id',
  'ticket_number',
  'thread_id',
  'subject',
  'status',
  'priority',
  'category',
  'assigned_to',
  'primary_order_id',
  'first_response_at',
  'resolved_at',
  'last_message_at',
  'last_message_body',
  'last_sender_role',
  'created_at',
  'updated_at',
  'version',
].join(',');

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function normalizeEnum(value, allowed) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return allowed.includes(normalized) ? normalized : null;
}

export function normalizeSupportTicketStatus(value) {
  return normalizeEnum(value, SUPPORT_TICKET_STATUSES);
}

export function normalizeSupportTicketPriority(value) {
  return normalizeEnum(value, SUPPORT_TICKET_PRIORITIES);
}

export function normalizeSupportTicketCategory(value) {
  return normalizeEnum(value, SUPPORT_TICKET_CATEGORIES);
}

export function normalizeSupportTicketVersion(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function normalizeSupportTicketSubject(value, initialBody) {
  if (value !== null && value !== undefined) {
    if (typeof value !== 'string') return null;
    const subject = value.trim();
    if (subject) {
      return Array.from(subject).length <= 200 && !CONTROL_CHARACTER.test(subject) ? subject : null;
    }
  }

  if (typeof initialBody !== 'string') return null;
  const line = initialBody
    .split(/\r\n?|\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return null;
  const subject = line.replace(/[ \t]+/g, ' ');
  return CONTROL_CHARACTER.test(subject) ? null : Array.from(subject).slice(0, 120).join('');
}

export function formatSupportTicketNumber(ticketNumber) {
  if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return null;
  return `MAS-${String(ticketNumber).padStart(6, '0')}`;
}

export function projectBuyerSupportTicket(ticket = {}) {
  const status = normalizeSupportTicketStatus(ticket.status);
  const ticketNumber = Number.isSafeInteger(ticket.ticket_number) && ticket.ticket_number > 0
    ? ticket.ticket_number
    : null;
  return {
    id: ticket.id,
    ticket_number: ticketNumber,
    display_number: formatSupportTicketNumber(ticketNumber),
    thread_id: ticket.thread_id,
    subject: ticket.subject,
    status,
    priority: normalizeSupportTicketPriority(ticket.priority),
    category: normalizeSupportTicketCategory(ticket.category),
    primary_order_id: ticket.primary_order_id,
    first_response_at: ticket.first_response_at,
    resolved_at: ticket.resolved_at,
    last_message_at: ticket.last_message_at,
    last_message_body: ticket.last_message_body,
    last_sender_role: ticket.last_sender_role,
    needs_staff_reply: Boolean(status && status !== 'resolved' && ticket.last_sender_role === 'buyer'),
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}

export function projectAdminSupportTicket(ticket = {}) {
  return {
    ...projectBuyerSupportTicket(ticket),
    assigned_to: ticket.assigned_to,
    version: ticket.version,
  };
}

export function supportTicketLegacyStatus(ticket = {}) {
  if (ticket.status === 'resolved') return 'complete';
  if (ticket.priority === 'high' || ticket.priority === 'urgent') return 'escalated';
  return 'open';
}

export function supportTicketTransition(value) {
  const status = String(value || '').trim();
  if (status === 'open') return { status: 'open', priority: 'normal' };
  if (status === 'escalated') return { status: 'open', priority: 'high' };
  if (status === 'complete') return { status: 'resolved', priority: null };
  return null;
}

export async function supportTicketById(sb, ticketId) {
  const id = String(ticketId || '').trim();
  if (!id) return null;
  const { data, error } = await sb.from('support_tickets')
    .select(SUPPORT_TICKET_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? projectAdminSupportTicket(data) : null;
}

async function firstTicketForThread(sb, threadId, { unresolvedOnly = false } = {}) {
  let query = sb.from('support_tickets')
    .select(SUPPORT_TICKET_SELECT)
    .eq('thread_id', threadId);
  if (unresolvedOnly) query = query.neq('status', 'resolved');
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? projectAdminSupportTicket(data) : null;
}

export async function supportTicketForThread(sb, threadId) {
  const id = String(threadId || '').trim();
  if (!id) return null;
  return (await firstTicketForThread(sb, id, { unresolvedOnly: true }))
    || firstTicketForThread(sb, id);
}

export async function supportTicketsForThreads(sb, threadIds) {
  const ids = [...new Set((threadIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await sb.from('support_tickets')
    .select(SUPPORT_TICKET_SELECT)
    .in('thread_id', ids)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return (data || []).map(projectAdminSupportTicket);
}

export async function updateSupportTicket(sb, {
  ticketId,
  expectedVersion,
  actorId,
  status = null,
  priority = null,
}) {
  const { data, error } = await sb.rpc('update_support_ticket', {
    p_ticket_id: ticketId,
    p_expected_version: expectedVersion,
    p_actor_id: actorId,
    p_status: status,
    p_priority: priority,
  });
  if (error) throw error;
  const ticket = data?.ticket || data;
  if (!ticket?.id) throw new Error('support_ticket_update_failed');
  return projectAdminSupportTicket(ticket);
}

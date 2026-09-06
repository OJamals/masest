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

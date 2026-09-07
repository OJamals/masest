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

export const SUPPORT_TICKET_QUEUES = Object.freeze([
  'all',
  'active',
  'needs_reply',
  'mine',
  'unassigned',
  'waiting',
  'resolved',
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/;
const MAX_CURSOR_LENGTH = 512;

function validCursorTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = CURSOR_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    , timezone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;
  if (timezone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function encodeBase64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  } catch {
    return null;
  }
}

export function encodeSupportCursor({ kind, timestamp, id } = {}) {
  if (!['ticket', 'message'].includes(kind) || !validCursorTimestamp(timestamp) || !UUID.test(id || '')) {
    return null;
  }
  return encodeBase64Url(JSON.stringify({ v: 1, k: kind, ts: timestamp, id }));
}

export function decodeSupportCursor(cursor, { kind } = {}) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > MAX_CURSOR_LENGTH
    || !['ticket', 'message'].includes(kind)) return null;
  const decoded = decodeBase64Url(cursor);
  if (!decoded || decoded.length > MAX_CURSOR_LENGTH) return null;
  try {
    const payload = JSON.parse(decoded);
    const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).sort()
      : [];
    if (keys.join(',') !== 'id,k,ts,v' || payload.v !== 1 || payload.k !== kind
      || !validCursorTimestamp(payload.ts) || !UUID.test(payload.id || '')) return null;
    return { timestamp: payload.ts, id: payload.id };
  } catch {
    return null;
  }
}

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

export function normalizeSupportTicketLimit(value, fallback = 50) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

export function escapeSupportLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
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
    category: normalizeSupportTicketCategory(ticket.category),
    primary_order_id: ticket.primary_order_id,
    first_response_at: ticket.first_response_at,
    resolved_at: ticket.resolved_at,
    last_message_at: ticket.last_message_at,
    last_message_body: ticket.last_message_body,
    last_sender_role: ticket.last_sender_role,
    needs_staff_reply: Boolean(status && status !== 'resolved' && ticket.last_sender_role === 'buyer'),
    scope: ticket.scope === 'company' ? 'company' : 'personal',
    order: ticket.order || null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}

export function projectAdminSupportTicket(ticket = {}) {
  return {
    ...projectBuyerSupportTicket(ticket),
    priority: normalizeSupportTicketPriority(ticket.priority),
    assigned_to: ticket.assigned_to,
    assignee: ticket.assignee || null,
    participant: ticket.participant || null,
    company: ticket.company || null,
    version: ticket.version,
  };
}

export async function listSupportTickets(sb, {
  queue = 'needs_reply',
  assigneeMode = null,
  assigneeId = null,
  staffId = null,
  status = null,
  priority = null,
  category = null,
  search = null,
  companyId = null,
  orderId = null,
  threadIds = null,
  cursor = null,
  limit = 50,
  projection = 'admin',
} = {}) {
  const decodedCursor = cursor ? decodeSupportCursor(cursor, { kind: 'ticket' }) : null;
  if (cursor && !decodedCursor) throw new Error('invalid_ticket_cursor');
  const { data, error } = await sb.rpc('list_support_tickets', {
    p_queue: queue,
    p_assignee_mode: assigneeMode,
    p_assignee_id: assigneeId,
    p_staff_id: staffId,
    p_status: status,
    p_priority: priority,
    p_category: category,
    p_search: search,
    p_company_id: companyId,
    p_order_id: orderId,
    p_thread_ids: threadIds === null
      ? null
      : [...new Set(threadIds.map((id) => String(id || '').trim()).filter(Boolean))],
    p_cursor_at: decodedCursor?.timestamp || null,
    p_cursor_id: decodedCursor?.id || null,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = Array.isArray(data?.tickets) ? data.tickets : [];
  const project = projection === 'buyer' ? projectBuyerSupportTicket : projectAdminSupportTicket;
  const next = data?.has_more === true && data?.next_cursor
    ? encodeSupportCursor({
      kind: 'ticket',
      timestamp: data.next_cursor.timestamp,
      id: data.next_cursor.id,
    })
    : null;
  if (data?.has_more === true && !next) throw new Error('support_ticket_cursor_missing');
  return {
    tickets: rows.map(project),
    summary: data?.summary && typeof data.summary === 'object' ? data.summary : {},
    has_more: data?.has_more === true,
    next_cursor: next,
  };
}

export async function listSupportAssignees(sb) {
  const { data, error } = await sb.from('profiles')
    .select('id,full_name,staff_role')
    .eq('is_staff', true)
    .in('staff_role', ['owner', 'finance', 'support'])
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data || []).map((profile) => ({
    id: profile.id,
    name: String(profile.full_name || '').trim() || 'Staff member',
    role: profile.staff_role,
  }));
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

export async function updateSupportTicket(sb, {
  ticketId,
  expectedVersion,
  actorId,
  status = null,
  priority = null,
  category = null,
  assignedTo = null,
  assignmentProvided = false,
}) {
  const { data, error } = await sb.rpc('update_support_ticket', {
    p_ticket_id: ticketId,
    p_expected_version: expectedVersion,
    p_actor_id: actorId,
    p_status: status,
    p_priority: priority,
    p_category: category,
    p_assigned_to: assignedTo,
    p_set_assigned_to: assignmentProvided,
  });
  if (error) throw error;
  const ticket = data?.ticket || data;
  if (!ticket?.id) throw new Error('support_ticket_update_failed');
  return projectAdminSupportTicket(ticket);
}

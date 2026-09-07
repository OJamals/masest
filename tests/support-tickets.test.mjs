import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  formatSupportTicketNumber,
  normalizeSupportTicketCategory,
  normalizeSupportTicketPriority,
  normalizeSupportTicketStatus,
  normalizeSupportTicketSubject,
  normalizeSupportTicketVersion,
  projectAdminSupportTicket,
  projectBuyerSupportTicket,
} from '../functions/_lib/support-tickets.js';

const ticket = {
  id: '11111111-1111-4111-8111-111111111111',
  ticket_number: 123,
  thread_id: '22222222-2222-4222-8222-222222222222',
  subject: 'Shipment arrived damaged',
  status: 'open',
  priority: 'high',
  category: 'shipping',
  assigned_to: '33333333-3333-4333-8333-333333333333',
  primary_order_id: '44444444-4444-4444-8444-444444444444',
  first_response_at: '2026-09-06T12:15:00.000Z',
  resolved_at: null,
  last_message_at: '2026-09-06T12:20:00.000Z',
  last_message_body: 'The package was crushed in transit.',
  last_sender_role: 'buyer',
  created_at: '2026-09-06T12:00:00.000Z',
  updated_at: '2026-09-06T12:20:00.000Z',
  version: 4,
  private_note: 'Do not expose this note.',
  events: [{ detail: { note: 'private' } }],
  unexpected: 'must not cross either projection',
};

test('support ticket enums expose only the planned domain values', () => {
  assert.deepEqual(SUPPORT_TICKET_STATUSES, ['open', 'waiting_on_customer', 'resolved']);
  assert.deepEqual(SUPPORT_TICKET_PRIORITIES, ['normal', 'high', 'urgent']);
  assert.deepEqual(SUPPORT_TICKET_CATEGORIES, [
    'general',
    'product',
    'order',
    'shipping',
    'billing',
    'account',
    'technical',
  ]);
});

test('support ticket enum normalizers trim strings without coercing other types', () => {
  assert.equal(normalizeSupportTicketStatus(' waiting_on_customer '), 'waiting_on_customer');
  assert.equal(normalizeSupportTicketPriority('urgent'), 'urgent');
  assert.equal(normalizeSupportTicketCategory(' billing '), 'billing');

  for (const invalid of ['complete', 'escalated', 'OPEN', '', 1, true, null, undefined, {}]) {
    assert.equal(normalizeSupportTicketStatus(invalid), null);
  }
  for (const invalid of ['low', 'HIGH', '', 1, null, []]) {
    assert.equal(normalizeSupportTicketPriority(invalid), null);
  }
  for (const invalid of ['returns', 'ORDER', '', 1, null, {}]) {
    assert.equal(normalizeSupportTicketCategory(invalid), null);
  }
});

test('ticket subject trims a valid explicit subject and rejects invalid explicit subjects', () => {
  assert.equal(normalizeSupportTicketSubject('  Need a replacement drum  '), 'Need a replacement drum');
  assert.equal(normalizeSupportTicketSubject(`${'x'.repeat(199)}🚚`), `${'x'.repeat(199)}🚚`);
  assert.equal(normalizeSupportTicketSubject('x'.repeat(201), 'fallback must not mask invalid input'), null);
  assert.equal(normalizeSupportTicketSubject('line one\nline two', 'fallback'), null);
  assert.equal(normalizeSupportTicketSubject({ toString: () => 'coerced' }, 'fallback'), null);
});

test('ticket subject falls back to the first nonempty body line and caps it at 120 characters', () => {
  assert.equal(
    normalizeSupportTicketSubject('   ', '\n \n  Pump pressure changed after cleaning  \nSecond line'),
    'Pump pressure changed after cleaning',
  );
  assert.equal(normalizeSupportTicketSubject(null, `${'a'.repeat(125)}\nsecond`), 'a'.repeat(120));
  assert.equal(normalizeSupportTicketSubject(null, `${'a'.repeat(119)}🚚`), `${'a'.repeat(119)}🚚`);
  assert.equal(normalizeSupportTicketSubject(null, 'First line\rSecond line'), 'First line');
  assert.equal(normalizeSupportTicketSubject(undefined, '\n\t\n'), null);
  assert.equal(normalizeSupportTicketSubject(undefined, 42), null);
});

test('ticket display number is six-digit padded and rejects non-positive or coerced numbers', () => {
  assert.equal(formatSupportTicketNumber(1), 'MAS-000001');
  assert.equal(formatSupportTicketNumber(123), 'MAS-000123');
  assert.equal(formatSupportTicketNumber(1_000_000), 'MAS-1000000');
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123', null, undefined]) {
    assert.equal(formatSupportTicketNumber(invalid), null);
  }
});

test('buyer ticket projection is an explicit allowlist with a derived reply state', () => {
  assert.deepEqual(projectBuyerSupportTicket(ticket), {
    id: ticket.id,
    ticket_number: 123,
    display_number: 'MAS-000123',
    thread_id: ticket.thread_id,
    subject: ticket.subject,
    status: 'open',
    category: 'shipping',
    primary_order_id: ticket.primary_order_id,
    first_response_at: ticket.first_response_at,
    resolved_at: null,
    last_message_at: ticket.last_message_at,
    last_message_body: ticket.last_message_body,
    last_sender_role: 'buyer',
    needs_staff_reply: true,
    scope: 'personal',
    order: null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  });
});

test('buyer projection never leaks assignee, version, private events, notes, or unknown fields', () => {
  const projected = projectBuyerSupportTicket(ticket);
  for (const privateField of ['assigned_to', 'version', 'events', 'private_note', 'unexpected']) {
    assert.equal(Object.hasOwn(projected, privateField), false);
  }
});

test('admin ticket projection adds only managed staff fields', () => {
  assert.deepEqual(projectAdminSupportTicket(ticket), {
    ...projectBuyerSupportTicket(ticket),
    priority: ticket.priority,
    assigned_to: ticket.assigned_to,
    assignee: null,
    participant: null,
    company: null,
    version: 4,
  });
  assert.equal(Object.hasOwn(projectAdminSupportTicket(ticket), 'events'), false);
  assert.equal(Object.hasOwn(projectAdminSupportTicket(ticket), 'private_note'), false);
  assert.equal(Object.hasOwn(projectAdminSupportTicket(ticket), 'unexpected'), false);
});

test('needs_staff_reply is false for staff-latest or resolved tickets', () => {
  assert.equal(projectBuyerSupportTicket({ ...ticket, last_sender_role: 'staff' }).needs_staff_reply, false);
  assert.equal(projectBuyerSupportTicket({ ...ticket, status: 'resolved' }).needs_staff_reply, false);
});

test('ticket version compare-and-swap input is a positive integer without coercion', () => {
  assert.equal(normalizeSupportTicketVersion(1), 1);
  assert.equal(normalizeSupportTicketVersion(42), 42);
  for (const invalid of [0, -1, 1.5, '4', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeSupportTicketVersion(invalid), null);
  }
});

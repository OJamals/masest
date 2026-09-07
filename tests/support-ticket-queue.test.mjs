import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeSupportCursor,
  encodeSupportCursor,
  projectBuyerSupportTicket,
} from '../functions/_lib/support-tickets.js';
import { messagePage } from '../functions/_lib/support-messages.js';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

test('support cursors round-trip exact PostgreSQL timestamp precision and reject another cursor kind', () => {
  const timestamp = '2026-09-06T14:00:00.123456+00:00';
  const cursor = encodeSupportCursor({ kind: 'ticket', timestamp, id: TICKET_ID });

  assert.deepEqual(decodeSupportCursor(cursor, { kind: 'ticket' }), {
    timestamp,
    id: TICKET_ID,
  });
  assert.equal(decodeSupportCursor(cursor, { kind: 'message' }), null);
});

test('support cursors reject malformed, oversized, invalid-date, and invalid-UUID payloads', () => {
  const encoded = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');

  assert.equal(decodeSupportCursor('not-json', { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor('x'.repeat(1025), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-99-99T99:99:99+00:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-09-06T14:00:00.123456+00:00',
    id: 'not-a-uuid',
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '0000-02-29T14:00:00.123456+00:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
  assert.equal(decodeSupportCursor(encoded({
    v: 1,
    k: 'ticket',
    ts: '2026-09-06T14:00:00.123456+16:00',
    id: TICKET_ID,
  }), { kind: 'ticket' }), null);
});

test('message pages use the last included composite row without losing microseconds', () => {
  const rows = [
    { id: '33333333-3333-4333-8333-333333333333', created_at: '2026-09-06T14:00:00.123457+00:00' },
    { id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-06T14:00:00.123456+00:00' },
    { id: TICKET_ID, created_at: '2026-09-06T14:00:00.123456+00:00' },
  ];

  const page = messagePage(rows, 2);

  assert.deepEqual(page.messages.map((message) => message.id), [rows[1].id, rows[0].id]);
  assert.equal(page.has_more, true);
  assert.deepEqual(decodeSupportCursor(page.next_message_cursor, { kind: 'message' }), {
    timestamp: rows[1].created_at,
    id: rows[1].id,
  });
});

test('buyer ticket projection excludes internal workflow priority and assignment', () => {
  const ticket = projectBuyerSupportTicket({
    id: TICKET_ID,
    ticket_number: 42,
    status: 'open',
    priority: 'urgent',
    assigned_to: '22222222-2222-4222-8222-222222222222',
    last_sender_role: 'buyer',
  });

  assert.equal(Object.hasOwn(ticket, 'priority'), false);
  assert.equal(Object.hasOwn(ticket, 'assigned_to'), false);
  assert.equal(ticket.needs_staff_reply, true);
});

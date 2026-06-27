import assert from 'node:assert/strict';
import test from 'node:test';
import { validSubject, noteRow, taskRow, taskPatch, mergeTimeline, filterCompanyEmails, NOTE_KINDS } from '../functions/_lib/crm.js';

test('validSubject accepts known types with an id', () => {
  assert.equal(validSubject('company', 'c1'), true);
  assert.equal(validSubject('quote', '42'), true);
  assert.equal(validSubject('user', 'x'), false);
  assert.equal(validSubject('company', ''), false);
});

test('noteRow validates and normalizes', () => {
  assert.equal(noteRow({ subject_type: 'x', subject_id: '1', body: 'hi' }).error, 'invalid_subject');
  assert.equal(noteRow({ subject_type: 'company', subject_id: '1', body: '   ' }).error, 'body_required');
  const ok = noteRow({ subject_type: 'company', subject_id: 1, kind: 'call', body: '  rang  ', actor: 'a@b.com' });
  assert.deepEqual(ok.row, { subject_type: 'company', subject_id: '1', kind: 'call', body: 'rang', created_by: 'a@b.com' });
  assert.equal(noteRow({ subject_type: 'company', subject_id: '1', kind: 'bogus', body: 'x' }).row.kind, 'note');
  assert.ok(NOTE_KINDS.includes('meeting'));
});

test('taskRow validates title, due date and assignee', () => {
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: '' }).error, 'title_required');
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: 'x', due_at: 'not-a-date' }).error, 'invalid_due_at');
  const ok = taskRow({ subject_type: 'company', subject_id: '1', title: ' call back ', due_at: '2026-07-01T10:00:00Z', assigned_to: ' a@b.com ', actor: 'me@x.com' });
  assert.equal(ok.row.title, 'call back');
  assert.equal(ok.row.due_at, '2026-07-01T10:00:00.000Z');
  assert.equal(ok.row.assigned_to, 'a@b.com');
  assert.equal(ok.row.status, 'open');
  assert.equal(ok.row.created_by, 'me@x.com');
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: 'x' }).row.due_at, null);
});

test('taskPatch transitions deterministically', () => {
  const now = new Date('2026-06-25T00:00:00Z');
  assert.deepEqual(taskPatch({ action: 'complete', actor: 'a@b.com' }, now).patch, { status: 'done', completed_at: '2026-06-25T00:00:00.000Z', completed_by: 'a@b.com' });
  assert.deepEqual(taskPatch({ action: 'reopen' }, now).patch, { status: 'open', completed_at: null, completed_by: null });
  assert.deepEqual(taskPatch({ action: 'reassign', assigned_to: ' x@y.com ' }, now).patch, { assigned_to: 'x@y.com' });
  assert.equal(taskPatch({ action: 'reassign', assigned_to: '' }, now).patch.assigned_to, null);
  assert.equal(taskPatch({ action: 'nope' }, now).error, 'invalid_action');
});

test('mergeTimeline normalizes, sorts newest-first and bounds', () => {
  const out = mergeTimeline({
    orders: [{ id: 7, status: 'paid', total: 12.5, currency: 'usd', created_at: '2026-06-20T00:00:00Z' }],
    messages: [{ id: 1, sender_role: 'buyer', body: 'hello', created_at: '2026-06-22T00:00:00Z' }],
    notes: [{ id: 3, kind: 'call', body: 'rang', created_by: 'a@b.com', created_at: '2026-06-23T00:00:00Z' }],
    tasks: [{ id: 9, title: 'follow up', assigned_to: 'a@b.com', created_at: '2026-06-21T00:00:00Z', completed_at: '2026-06-24T00:00:00Z', completed_by: 'a@b.com' }],
  });
  assert.equal(out[0].type, 'task_done', 'newest is the completion at 06-24');
  assert.equal(out[1].type, 'note:call');
  assert.equal(out.at(-1).type, 'order', 'oldest is the order at 06-20');
  assert.ok(out.every((i) => typeof i.at === 'string' && i.title));
  assert.equal(mergeTimeline({}).length, 0);
});

test('mergeTimeline respects the limit', () => {
  const orders = Array.from({ length: 50 }, (_, i) => ({ id: i, status: 'x', created_at: `2026-06-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` }));
  assert.equal(mergeTimeline({ orders }, { limit: 10 }).length, 10);
});

test('mergeTimeline includes email events with status-typed entries', () => {
  const out = mergeTimeline({
    emails: [
      { id: 1, to_email: 'b@x.co', subject: 'Order confirmed', category: 'order', status: 'delivered', created_at: '2026-06-25T00:00:00Z' },
      { id: 2, to_email: 'b@x.co', subject: 'Offer', category: 'offer', status: 'bounced', created_at: '2026-06-26T00:00:00Z' },
    ],
  });
  assert.equal(out[0].type, 'email:bounced', 'newest first');
  assert.match(out[0].detail, /Offer · offer/);
  assert.equal(out[1].type, 'email:delivered');
  assert.match(out[1].detail, /Order confirmed/);
});

test('filterCompanyEmails keeps only events for the company addresses, deduped', () => {
  const events = [
    { id: 1, to_email: 'buyer@acme.co, notify@masest.co' }, // joined recipient list
    { id: 2, to_email: 'BUYER@ACME.CO' },                    // case-insensitive
    { id: 1, to_email: 'buyer@acme.co' },                    // duplicate id → dropped
    { id: 3, to_email: 'someone-else@other.co' },            // no match → dropped
    { id: 4, to_email: '' },                                 // empty → dropped
  ];
  const out = filterCompanyEmails(events, ['buyer@acme.co']);
  assert.deepEqual(out.map((e) => e.id), [1, 2]);
});

test('filterCompanyEmails returns [] when no company emails are known', () => {
  assert.deepEqual(filterCompanyEmails([{ id: 1, to_email: 'a@b.co' }], []), []);
});

test('filterCompanyEmails matches a full address inside a joined recipient list', () => {
  // The needle is a whole company address; it is found as a substring of the
  // comma-joined to_email — the reason matching is substring rather than equality.
  const out = filterCompanyEmails([{ id: 1, to_email: 'ops@masest.co, buyer@acme.co' }], ['buyer@acme.co']);
  assert.deepEqual(out.map((e) => e.id), [1]);
});

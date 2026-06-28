import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDigest } from '../functions/_lib/crm.js';

// Fixed clock so all overdueDays assertions are deterministic.
const now = new Date('2026-06-28T13:00:00Z');
const dayAgo = new Date(now - 86400000).toISOString();       // 1 day overdue
const twoDaysAgo = new Date(now - 2 * 86400000).toISOString(); // 2 days overdue
const threeDaysAgo = new Date(now - 3 * 86400000).toISOString(); // 3 days overdue

test('empty input returns {groups:[], total:0}', () => {
  const r = taskDigest([], { now });
  assert.deepEqual(r.groups, []);
  assert.equal(r.total, 0);
});

test('null/undefined tasks input returns {groups:[], total:0}', () => {
  const r = taskDigest(undefined, { now });
  assert.deepEqual(r.groups, []);
  assert.equal(r.total, 0);
});

test('groups tasks by assignee email, one group per unique address', () => {
  const tasks = [
    { id: 1, title: 'Task A', assigned_to: 'alice@example.com', due_at: dayAgo, status: 'open' },
    { id: 2, title: 'Task B', assigned_to: 'alice@example.com', due_at: twoDaysAgo, status: 'open' },
    { id: 3, title: 'Task C', assigned_to: 'bob@example.com', due_at: dayAgo, status: 'open' },
  ];
  const { groups, total } = taskDigest(tasks, { now });
  assert.equal(total, 3);
  assert.equal(groups.length, 2);
  const alice = groups.find((g) => g.key === 'alice@example.com');
  assert.ok(alice, 'alice group missing');
  assert.equal(alice.assignee, 'alice@example.com');
  assert.equal(alice.tasks.length, 2);
  const bob = groups.find((g) => g.key === 'bob@example.com');
  assert.ok(bob, 'bob group missing');
  assert.equal(bob.tasks.length, 1);
});

test('email matching is case-insensitive (lowercased key + assignee)', () => {
  const tasks = [
    { id: 1, title: 'T', assigned_to: 'Alice@Example.COM', due_at: dayAgo, status: 'open' },
  ];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups[0].key, 'alice@example.com');
  assert.equal(groups[0].assignee, 'alice@example.com');
});

test('empty assigned_to goes to staff bucket with null assignee', () => {
  const tasks = [{ id: 1, title: 'T', assigned_to: '', due_at: dayAgo, status: 'open' }];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, '__staff__');
  assert.equal(groups[0].assignee, null);
});

test('null assigned_to goes to staff bucket', () => {
  const tasks = [{ id: 1, title: 'T', assigned_to: null, due_at: dayAgo, status: 'open' }];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups[0].key, '__staff__');
  assert.equal(groups[0].assignee, null);
});

test('non-email string assigned_to goes to staff bucket', () => {
  const tasks = [{ id: 1, title: 'T', assigned_to: 'not-an-email', due_at: dayAgo, status: 'open' }];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups[0].key, '__staff__');
  assert.equal(groups[0].assignee, null);
});

test('multiple non-email / empty assigned_to all land in one staff bucket', () => {
  const tasks = [
    { id: 1, title: 'T1', assigned_to: '', due_at: dayAgo, status: 'open' },
    { id: 2, title: 'T2', assigned_to: null, due_at: dayAgo, status: 'open' },
    { id: 3, title: 'T3', assigned_to: 'not-an-email', due_at: dayAgo, status: 'open' },
  ];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tasks.length, 3);
});

test('overdueDays math uses injected now — 2-day-old task returns 2', () => {
  const tasks = [{ id: 1, title: 'T', assigned_to: 'a@b.co', due_at: twoDaysAgo, status: 'open' }];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups[0].tasks[0].overdueDays, 2);
});

test('overdueDays is at least 0 (never negative)', () => {
  // Simulate a task just barely not overdue at injection time (Math.max(0,...))
  const almostFuture = new Date(now.getTime() - 1000).toISOString(); // 1s overdue
  const tasks = [{ id: 1, title: 'T', assigned_to: 'a@b.co', due_at: almostFuture, status: 'open' }];
  const { groups } = taskDigest(tasks, { now });
  assert.equal(groups[0].tasks[0].overdueDays, 0);
});

test('groups are sorted by key (ascending lexicographic)', () => {
  const tasks = [
    { id: 1, title: 'Z task', assigned_to: 'z@example.com', due_at: dayAgo, status: 'open' },
    { id: 2, title: 'Staff', assigned_to: '', due_at: dayAgo, status: 'open' },
    { id: 3, title: 'A task', assigned_to: 'a@example.com', due_at: dayAgo, status: 'open' },
  ];
  const { groups } = taskDigest(tasks, { now });
  // '__staff__' (_=95) < 'a@...' (a=97) < 'z@...'
  assert.equal(groups[0].key, '__staff__');
  assert.equal(groups[1].key, 'a@example.com');
  assert.equal(groups[2].key, 'z@example.com');
});

test('tasks within a group are sorted by due_at ascending (most overdue first)', () => {
  const tasks = [
    { id: 1, title: 'Newer', assigned_to: 'a@b.co', due_at: dayAgo, status: 'open' },
    { id: 2, title: 'Oldest', assigned_to: 'a@b.co', due_at: threeDaysAgo, status: 'open' },
    { id: 3, title: 'Middle', assigned_to: 'a@b.co', due_at: twoDaysAgo, status: 'open' },
  ];
  const { groups } = taskDigest(tasks, { now });
  const ids = groups[0].tasks.map((t) => t.id);
  assert.deepEqual(ids, [2, 3, 1]); // oldest due first
});

test('custom staffKey is respected', () => {
  const tasks = [{ id: 1, title: 'T', assigned_to: '', due_at: dayAgo, status: 'open' }];
  const { groups } = taskDigest(tasks, { now, staffKey: 'UNASSIGNED' });
  assert.equal(groups[0].key, 'UNASSIGNED');
});

test('total equals input task count regardless of grouping', () => {
  const tasks = [
    { id: 1, title: 'T1', assigned_to: 'a@b.co', due_at: dayAgo, status: 'open' },
    { id: 2, title: 'T2', assigned_to: 'b@c.co', due_at: twoDaysAgo, status: 'open' },
    { id: 3, title: 'T3', assigned_to: '', due_at: dayAgo, status: 'open' },
  ];
  const { total } = taskDigest(tasks, { now });
  assert.equal(total, 3);
});

test('sanity: one email assignee + one unassigned → 2 groups, total 2', () => {
  const tasks = [
    { id: 1, title: 'x', assigned_to: 'a@b.co', due_at: twoDaysAgo, status: 'open' },
    { id: 2, title: 'y', assigned_to: '', due_at: dayAgo, status: 'open' },
  ];
  const r = taskDigest(tasks, { now });
  assert.equal(JSON.stringify(r.total), '2');
  assert.equal(r.groups.length, 2);
});

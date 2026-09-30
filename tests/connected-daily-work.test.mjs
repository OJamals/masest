import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedSalesTarget } from '../functions/_lib/connected-sales-route.js';
import * as contract from '../js/admin/connected-sales-contract.js';
const id = () => crypto.randomUUID();

test('daily reads have narrow typed bridge routes and remain read-only', () => {
  const person = id();
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_timeline', person_id: person, limit: '10' }), 'GET'), `/v1/sales/people/${person}/timeline?limit=10`);
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_timeline', person_id: person }), 'POST'), null);
  const query = new URLSearchParams({ resource: 'sales_tasks', priority: 'high', due: 'overdue', assignment: 'unassigned' });
  assert.equal(connectedSalesTarget(query, 'GET'), '/v1/sales/tasks?priority=high&due=overdue&assignment=unassigned');
  for (const [key, value] of [['due', 'today'], ['assignment', 'arbitrary'], ['priority', 'urgent']]) {
    assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_tasks', [key]: value }), 'GET'), null);
  }
});

test('summary validates counts and preserves unknown amounts and separate currencies', () => {
  const value = { tasks: { open: 5, overdue: 2, completed: 1 }, deals: [
    { currency: 'USD', status: 'open', count: 2, amount: '10.50', unknown_amount_count: 1 },
    { currency: 'EUR', status: 'won', count: 1, amount: null, unknown_amount_count: 1 },
  ] };
  assert.equal(contract.salesSummary(value), value);
  for (const bad of [{ ...value, tasks: { open: 1, overdue: 2, completed: 0 } }, { ...value, deals: [{ ...value.deals[0], unknown_amount_count: 3 }] }, { ...value, deals: [value.deals[0], value.deals[0]] }, { ...value, tasks: {} }]) assert.throws(() => contract.salesSummary(bad));
});

test('timeline accepts only requested prospect and valid entity attribution', () => {
  const person = id();
  const event = { id: id(), person_id: person, entity_type: 'task', entity_id: id(), title: 'Synthetic', reason: 'Reviewed', created_at: new Date().toISOString(), actor_staff_id: id(), actor_role: 'support' };
  const page = { items: [event], next_cursor: null };
  assert.equal(contract.salesTimeline(page, person), page);
  for (const changed of [{ person_id: id() }, { entity_type: 'pipeline' }, { actor_staff_id: null }, { created_at: 'tomorrow' }, { title: 'x'.repeat(201) }]) assert.throws(() => contract.salesTimeline({ ...page, items: [{ ...event, ...changed }] }, person));
});

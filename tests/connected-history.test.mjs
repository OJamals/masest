import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedSalesTarget } from '../functions/_lib/connected-sales-route.js';
import { directoryPage, engagementPage, accountTimeline } from '../js/admin/connected-history-contract.js';
const id = () => crypto.randomUUID();
test('account and engagement reads cannot mutate or inject sections/scope', () => {
  const person = id(); const organization = id();
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_accounts' }), 'GET'), '/v1/sales/accounts');
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_account_timeline', organization_id: organization }), 'GET'), `/v1/sales/accounts/${organization}/timeline`);
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_engagement', person_id: person, section: 'activities', limit: '10' }), 'GET'), `/v1/sales/people/${person}/engagement/activities?limit=10`);
  for (const section of ['drafts', '../activities']) assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_engagement', person_id: person, section }), 'GET'), null);
  assert.equal(connectedSalesTarget(new URLSearchParams({ resource: 'sales_accounts' }), 'POST'), null);
});
test('directory and history decoders reject wrong subject, role and malformed timestamps', () => {
  const person = id(); const entry = { id: id(), person_id: person, section: 'activities', created_at: new Date().toISOString(), occurred_at: new Date().toISOString(), kind: 'note', source: 'synthetic', reason: '', note: 'Hello' };
  const page = { items: [entry], next_cursor: null };
  assert.equal(engagementPage(page, person, 'activities'), page);
  for (const changed of [{ person_id: id() }, { section: 'handoffs' }, { occurred_at: 'bad' }, { note: {} }]) assert.throws(() => engagementPage({ ...page, items: [{ ...entry, ...changed }] }, person, 'activities'));
  assert.throws(() => directoryPage({ items: [{ staff_id: id(), display_name: 'Fake', role: 'read_only' }], next_cursor: null }));
  const event = { id: id(), organization_id: person, entity_type: 'task', entity_id: id(), title: 'Account task', reason: 'Created', created_at: entry.created_at, actor_staff_id: null, actor_role: null };
  assert.equal(accountTimeline({ items: [event], next_cursor: null }, person).items[0], event);
  assert.throws(() => accountTimeline({ items: [event], next_cursor: null }, id()));
});

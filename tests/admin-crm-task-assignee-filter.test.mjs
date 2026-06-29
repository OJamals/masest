// Task inbox assignee filter (CRM polish): pure facet + filter helpers that let
// a manager narrow the loaded open/overdue task list to one assignee (or the
// unassigned bucket) entirely client-side — no new API surface, no migration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { taskAssigneeFacets, filterTasksByAssignee, UNASSIGNED } from '../js/admin/crm-task-filter.js';

const tasks = [
  { id: 1, title: 'a', assigned_to: 'alice@masest.co' },
  { id: 2, title: 'b', assigned_to: 'bob@masest.co' },
  { id: 3, title: 'c', assigned_to: 'alice@masest.co' },
  { id: 4, title: 'd', assigned_to: '' },
  { id: 5, title: 'e', assigned_to: null },
];

test('facets bucket distinct assignees with counts plus an unassigned bucket and an All head', () => {
  const facets = taskAssigneeFacets(tasks);
  // First option is always the "All" head with the full count.
  assert.deepEqual(facets[0], { value: '', label: 'All assignees', count: 5 });
  const byValue = Object.fromEntries(facets.map((f) => [f.value, f]));
  assert.equal(byValue['alice@masest.co'].count, 2);
  assert.equal(byValue['bob@masest.co'].count, 1);
  assert.equal(byValue[UNASSIGNED].count, 2);
  assert.equal(byValue[UNASSIGNED].label, 'Unassigned');
});

test('assignees are sorted case-insensitively; unassigned sorts last', () => {
  const facets = taskAssigneeFacets([
    { id: 1, assigned_to: 'Zoe@masest.co' },
    { id: 2, assigned_to: 'amy@masest.co' },
    { id: 3, assigned_to: null },
  ]);
  assert.deepEqual(facets.map((f) => f.value), ['', 'amy@masest.co', 'Zoe@masest.co', UNASSIGNED]);
});

test('facets collapse to just the All head when every task shares one assignee', () => {
  // With a single bucket there is nothing to filter — UI hides the control.
  const facets = taskAssigneeFacets([
    { id: 1, assigned_to: 'solo@masest.co' },
    { id: 2, assigned_to: 'solo@masest.co' },
  ]);
  assert.equal(facets.length, 2); // All + solo only → length 2, UI suppresses
  assert.equal(taskAssigneeFacets([]).length, 1); // empty → just All
});

test('filterTasksByAssignee narrows by exact assignee, the unassigned bucket, or all', () => {
  assert.deepEqual(filterTasksByAssignee(tasks, '').map((t) => t.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(filterTasksByAssignee(tasks, 'alice@masest.co').map((t) => t.id), [1, 3]);
  assert.deepEqual(filterTasksByAssignee(tasks, UNASSIGNED).map((t) => t.id), [4, 5]);
  // Unknown assignee → empty (defensive; selection that no longer exists).
  assert.deepEqual(filterTasksByAssignee(tasks, 'ghost@masest.co'), []);
});

test('helpers never mutate the input array', () => {
  const copy = tasks.slice();
  taskAssigneeFacets(tasks);
  filterTasksByAssignee(tasks, 'alice@masest.co');
  assert.deepEqual(tasks, copy);
});

// The UI module must wire the helpers + a dedicated select control.
const WS = readFileSync(new URL('../js/admin/crm-workspace.js', import.meta.url), 'utf8');
test('crm-workspace imports and renders the assignee filter control', () => {
  assert.match(WS, /taskAssigneeFacets|filterTasksByAssignee/);
  assert.match(WS, /data-inbox-assignee/);
  assert.match(WS, /state\.crmTaskAssignee/);
});

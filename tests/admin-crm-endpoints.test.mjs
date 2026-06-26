import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOTES = read('functions/api/admin/crm/notes.js');
const TASKS = read('functions/api/admin/crm/tasks.js');
const TIMELINE = read('functions/api/admin/crm/timeline.js');

for (const [name, src] of [['notes', NOTES], ['tasks', TASKS], ['timeline', TIMELINE]]) {
  test(`${name} uses the correct _lib import depth`, () => {
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/_lib\/supabase\.js'/, 'crm subfolder must import _lib three levels up');
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/_lib\//, 'two-level import would break the esbuild bundle');
  });
  test(`${name} is staff-guarded`, () => {
    assert.match(src, /requireStaff\(\s*request\s*,\s*env\s*\)/);
    assert.match(src, /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401/);
    assert.match(src, /if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403/);
    assert.match(src, /validSubject/);
  });
}

test('notes/tasks gate writes behind staffCanWrite and audit them', () => {
  for (const src of [NOTES, TASKS]) {
    assert.match(src, /staffCanWrite\(role\)/);
    assert.match(src, /recordAudit\(sb,/);
  }
  assert.match(NOTES, /noteRow\(/);
  assert.match(TASKS, /taskRow\(/);
  assert.match(TASKS, /taskPatch\(/);
});

test('notes DELETE is author-or-owner only', () => {
  assert.match(NOTES, /method\s*===\s*'DELETE'|request\.method === 'DELETE'/);
  assert.match(NOTES, /role === 'owner'/);
  assert.match(NOTES, /not_author/);
  assert.match(NOTES, /deleted_at/);
});

test('timeline merges sources virtually and tolerates missing tables', () => {
  assert.match(TIMELINE, /mergeTimeline\(/);
  assert.match(TIMELINE, /async function safe\(/);
  assert.match(TIMELINE, /from\('orders'\)/);
  assert.match(TIMELINE, /from\('messages'\)/);
  assert.match(TIMELINE, /from\('shipment_events'\)/);
  assert.match(TIMELINE, /from\('audit_log'\)/);
  assert.match(TIMELINE, /from\('quotes'\)/);
});

test('tasks endpoint supports global scopes', () => {
  assert.match(TASKS, /scope === 'mine'/);
  assert.match(TASKS, /scope === 'overdue'/);
  assert.match(TASKS, /scope === 'open'/);
});

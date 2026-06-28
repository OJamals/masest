import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WS = read('js/admin/crm-workspace.js');
const ADMIN = read('js/admin.js');
const HTML = read('admin.html');

test('workspace exports a mountable factory', () => {
  assert.match(WS, /export function createCrmWorkspace/);
  assert.match(WS, /return \{ renderCrm, wireCrm \}/);
  // Sub-tabs are generated from SUBTABS — verify both values are declared
  assert.match(WS, /'tasks'/);
  assert.match(WS, /'contacts'/);
  // The data attribute is present (template-generated)
  assert.match(WS, /data-crm-ws-tab=/);
});

test('workspace shell uses aria-pressed and admEmpty placeholders', () => {
  assert.match(WS, /aria-pressed/);
  assert.match(WS, /admEmpty\('ph-check-square'/);
  assert.match(WS, /admEmpty\('ph-address-book'/);
  assert.match(WS, /aria-live="polite"/);
});

test('admin.html declares the CRM tab + panel', () => {
  assert.equal((HTML.match(/data-tab="crm"/g) || []).length, 1);
  assert.match(HTML, /data-panel="crm"[\s\S]*id="admCrm"/);
});

test('admin.js wires the workspace tab', () => {
  assert.match(ADMIN, /import \{ createCrmWorkspace \}/);
  assert.match(ADMIN, /crm: \(\) => renderCrm\(\)/);
  assert.match(ADMIN, /wireCrm\(\)/);
});

test('workspace delegates events on stable container (no per-render listener leak)', () => {
  assert.match(WS, /delegate\(/);
  assert.match(WS, /\[data-crm-ws-tab\]/);
});

// Plan 002: task inbox assertions
test('renderTasks calls the scoped tasks endpoint', () => {
  assert.match(WS, /\/api\/admin\/crm\/tasks\?scope=/);
});

test('inbox renders three scope filter buttons (open, mine, overdue)', () => {
  // Scope buttons are rendered dynamically from TASK_SCOPES — verify the
  // attribute is present and all three scope values are declared.
  assert.match(WS, /data-inbox-scope=/);
  assert.match(WS, /'open'/);
  assert.match(WS, /'mine'/);
  assert.match(WS, /'overdue'/);
  // TASK_SCOPES must declare all three scope values
  assert.match(WS, /TASK_SCOPES/);
});

test('task rows carry data-inbox-toggle and crm-task class', () => {
  assert.match(WS, /data-inbox-toggle=/);
  assert.match(WS, /"crm-task"/);
});

test('PATCH complete/reopen actions are used for toggle', () => {
  assert.match(WS, /action.*complete|complete.*action/);
  assert.match(WS, /action.*reopen|reopen.*action/);
  assert.match(WS, /method: 'PATCH'/);
});

test('scope toggle handler updates state and re-renders', () => {
  assert.match(WS, /state\.crmTaskScope/);
  assert.match(WS, /\[data-inbox-scope\]/);
  assert.match(WS, /renderTasks\(box\.querySelector\('\[data-crm-ws-body\]'\)\)/);
});

test('needs_migration fallback shown in inbox', () => {
  assert.match(WS, /needs_migration/);
  assert.match(WS, /schema-crm\.sql/);
});

// Plan 003: contact directory assertions
const CRM = read('js/admin/crm.js');

test('crm.js exports openContactDrawer on the returned object', () => {
  assert.match(CRM, /return \{ mount, openContactDrawer \}/);
});

test('crm-workspace.js renderContacts calls /api/admin/crm/contacts?q=', () => {
  assert.match(WS, /\/api\/admin\/crm\/contacts\?q=/);
});

test('crm-workspace.js renders data-dir-open buttons for results', () => {
  assert.match(WS, /data-dir-open=/);
});

test('crm-workspace.js accepts crm in factory args and uses openContactDrawer', () => {
  assert.match(WS, /createCrmWorkspace\(\{[^}]*crm[^}]*\}|crm \}/);
  assert.match(WS, /crm\?\.openContactDrawer/);
});

test('admin.js passes crm into createCrmWorkspace', () => {
  assert.match(ADMIN, /createCrmWorkspace\(\{[^}]*crm[^}]*\}|createCrmWorkspace\(\{.*crm.*\}\)/);
});

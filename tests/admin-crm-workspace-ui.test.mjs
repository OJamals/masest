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

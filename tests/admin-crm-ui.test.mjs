import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CRM = read('js/admin/crm.js');
const ADMIN = read('js/admin.js');
const COMPANIES = read('js/admin/companies.js');
const CSS = read('css/components.css');

test('crm.js exposes a mountable panel with all three tabs', () => {
  assert.match(CRM, /export function createCrmPanel/);
  assert.match(CRM, /data-crm-tab="timeline"/);
  assert.match(CRM, /data-crm-tab="tasks"/);
  assert.match(CRM, /data-crm-tab="notes"/);
  assert.match(CRM, /function mount\(/);
});

test('crm.js calls all three endpoints', () => {
  assert.match(CRM, /\/api\/admin\/crm\/timeline\?subject_type=/);
  assert.match(CRM, /\/api\/admin\/crm\/notes/);
  assert.match(CRM, /\/api\/admin\/crm\/tasks/);
  assert.match(CRM, /method: 'DELETE'/);
  assert.match(CRM, /method: 'PATCH'/);
});

test('crm.js renders loading/empty states and is keyboard-operable', () => {
  assert.match(CRM, /admSkeleton/);
  assert.match(CRM, /admEmpty/);
  assert.match(CRM, /aria-pressed/);
  assert.match(CRM, /aria-live="polite"/);
});

test('admin.js wires the CRM panel into the companies tab', () => {
  assert.match(ADMIN, /import \{ createCrmPanel \} from '\.\/admin\/crm\.js'/);
  assert.match(ADMIN, /const crm = createCrmPanel\(\{[^}]*\}\)/);
  assert.match(ADMIN, /createCompaniesTab\(\{[^}]*crm[^}]*\}\)/);
});

test('companies drawer mounts the CRM panel', () => {
  assert.match(COMPANIES, /createCompaniesTab\(\{[^}]*crm[^}]*\}\)/);
  assert.match(COMPANIES, /crm\.mount\(box, 'company', company\.id/);
});

test('crm panel has styles', () => {
  assert.match(CSS, /\.crm-panel/);
  assert.match(CSS, /\.crm-feed/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('Contacts tab renders only for company subjects', () => {
  assert.match(src, /subjectType === 'company' \? '<button[^']*data-crm-tab="contacts"/);
});

test('contacts load hits the company-scoped endpoint', () => {
  assert.match(src, /\/api\/admin\/crm\/contacts\?company_id=\$\{sid\}/);
  assert.match(src, /body\._contacts = contacts \|\| \[\]/);
});

test('composer carries name, role select, email + primary', () => {
  assert.match(src, /data-crm-contact-form/);
  assert.match(src, /data-crm-contact-name/);
  assert.match(src, /data-crm-contact-role/);
  assert.match(src, /data-crm-contact-email/);
  assert.match(src, /data-crm-contact-primary\b/);
});

test('wires set-primary, edit, delete and create/update submit', () => {
  assert.match(src, /data-crm-contact-primary-set/);
  assert.match(src, /data-crm-contact-edit/);
  assert.match(src, /data-crm-contact-del/);
  assert.match(src, /if \(form\.dataset\.editId\) payload\.id = form\.dataset\.editId/);
  assert.match(src, /method: 'DELETE' \}\); load\(body, subjectType, subjectId, 'contacts'\)/);
});

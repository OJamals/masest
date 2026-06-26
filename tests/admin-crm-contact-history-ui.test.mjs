import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('each contact row offers a History button', () => {
  assert.match(src, /data-crm-contact-history="\$\{esc\(c\.id\)\}"/);
});

test('History opens a contact drawer that reuses the panel as a contact subject', () => {
  assert.match(src, /function openContactDrawer\(contact\)/);
  assert.match(src, /data-contact-drawer/);
  assert.match(src, /mount\(dlg\.querySelector\('\[data-contact-crm\]'\), 'contact', contact\.id\)/);
});

test('click handler routes the History button to the drawer', () => {
  assert.match(src, /closest\('\[data-crm-contact-history\]'\)/);
  assert.match(src, /if \(c\) openContactDrawer\(c\)/);
});

// Source-contract tests for the contact directory paging + role-filter additions
// in js/admin/crm-workspace.js and js/admin.js (plan 009).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ws = readFileSync(new URL('../js/admin/crm-workspace.js', import.meta.url), 'utf8');
const adm = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');

// --- crm-workspace.js ---

test('DIR_ROLES constant defined with all-roles sentinel and 8 role entries', () => {
  assert.match(ws, /const DIR_ROLES = \[/);
  assert.match(ws, /\['', 'All roles'\]/);
  assert.match(ws, /\['procurement', 'Procurement'\]/);
  assert.match(ws, /\['plant_manager', 'Plant Manager'\]/);
  assert.match(ws, /\['accounts_payable', 'Accounts Payable'\]/);
  assert.match(ws, /\['other', 'Other'\]/);
});

test('factory accepts admListPager in destructured args', () => {
  assert.match(ws, /createCrmWorkspace\(\{[^}]*admListPager[^}]*\}\)/);
});

test('renderContacts renders a [data-dir-role] select element', () => {
  assert.match(ws, /data-dir-role/);
  assert.match(ws, /<select[^>]*data-dir-role/);
});

test('renderContacts auto-runs search when role is set (state.crmContactRole)', () => {
  assert.match(ws, /state\.crmContactRole/);
  assert.match(ws, /currentRole\) await runContactSearch/);
});

test('runContactSearch reads state.crmContactQ and state.crmContactRole', () => {
  assert.match(ws, /const q = state\.crmContactQ \|\| ''/);
  assert.match(ws, /const role = state\.crmContactRole \|\| ''/);
});

test('runContactSearch supports append parameter for offset accumulation', () => {
  assert.match(ws, /\{ append = false \} = \{\}/);
  assert.match(ws, /append \? \(results\._contacts\?\.length \|\| 0\) : 0/);
});

test('runContactSearch concatenates next page when appending', () => {
  assert.match(ws, /append \? \[\.\.\.\(results\._contacts \|\| \[\]\), \.\.\.\(contacts \|\| \[\]\)\] : \(contacts \|\| \[\]\)/);
});

test('runContactSearch keeps accumulated array on results._contacts', () => {
  assert.match(ws, /results\._contacts = next/);
});

test('runContactSearch calls admListPager for load-more footer', () => {
  assert.match(ws, /admListPager\('data-dir-more', next\.length, total, has_more\)/);
});

test('runContactSearch includes role and q in fetch params conditionally', () => {
  assert.match(ws, /if \(q\.length >= 2\) params\.set\('q', q\)/);
  assert.match(ws, /if \(role\) params\.set\('role', role\)/);
});

test('wireCrm wires change event on [data-dir-role] (not click)', () => {
  assert.match(ws, /delegate\(box, 'change', '\[data-dir-role\]'/);
});

test('wireCrm sets state.crmContactRole from select value on role change', () => {
  assert.match(ws, /state\.crmContactRole = sel\.value/);
});

test('wireCrm wires click on [data-dir-more] for load-more', () => {
  assert.match(ws, /delegate\(box, 'click', '\[data-dir-more\]'/);
  assert.match(ws, /append: true/);
});

test('[data-dir-open] handler still reads results._contacts by id (plan 007 compat)', () => {
  assert.match(ws, /results\?._contacts \|\| \[\]\)\.find\(\(x\) => String\(x\.id\) === String\(btn\.dataset\.dirOpen\)\)/);
});

test('form submit sets state.crmContactQ and calls runContactSearch with append:false', () => {
  assert.match(ws, /state\.crmContactQ = form\.querySelector\('\[data-dir-q\]'\)\.value\.trim\(\)/);
  assert.match(ws, /runContactSearch\(box\.querySelector\('\[data-crm-ws-body\]'\), \{ append: false \}\)/);
});

// --- admin.js ---

test('admin.js passes admListPager into createCrmWorkspace', () => {
  assert.match(adm, /createCrmWorkspace\(\{[^}]*admListPager[^}]*\}\)/);
});

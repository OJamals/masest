import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contactEmailKey,
  parseContactsCsv,
  prepareContactImportRows,
} from '../functions/_lib/crm-contacts.js';

test('parses a header row + maps columns by name', () => {
  const rows = parseContactsCsv('name,role,email\nJane Doe,procurement,jane@acme.co\nBob,maintenance,bob@acme.co');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Jane Doe', role: 'procurement', email: 'jane@acme.co' });
});

test('header column order is respected (reordered + partial)', () => {
  const rows = parseContactsCsv('email,name\njane@acme.co,Jane');
  assert.deepEqual(rows[0], { email: 'jane@acme.co', name: 'Jane' });
});

test('falls back to positional columns when no header', () => {
  const rows = parseContactsCsv('Jane Doe,procurement,Buyer,jane@acme.co,555-1212');
  assert.deepEqual(rows[0], { name: 'Jane Doe', role: 'procurement', title: 'Buyer', email: 'jane@acme.co', phone: '555-1212' });
});

test('honors quoted fields with embedded commas + escaped quotes', () => {
  const rows = parseContactsCsv('name,title\n"Doe, Jane","VP, Ops"\n"Quote ""Q""",Buyer');
  assert.equal(rows[0].name, 'Doe, Jane');
  assert.equal(rows[0].title, 'VP, Ops');
  assert.equal(rows[1].name, 'Quote "Q"');
});

test('drops rows without a name + blank lines', () => {
  const rows = parseContactsCsv('name,email\n,nobody@acme.co\n\nJane,jane@acme.co');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Jane');
});

test('empty input yields no rows', () => {
  assert.deepEqual(parseContactsCsv(''), []);
  assert.deepEqual(parseContactsCsv('   '), []);
});

test('contactEmailKey normalizes emails for case-insensitive import dedup', () => {
  assert.equal(contactEmailKey(' Jane@Acme.CO '), 'jane@acme.co');
  assert.equal(contactEmailKey('   '), '');
  assert.equal(contactEmailKey(null), '');
});

test('prepareContactImportRows skips duplicate emails inside one CSV batch', () => {
  const parsed = parseContactsCsv('name,email\nJane,jane@acme.co\nJanet, JANE@ACME.CO \nBob,bob@acme.co');
  const result = prepareContactImportRows(parsed, { companyId: 'co_1', actor: 'staff@masest.co' });

  assert.deepEqual(result.rows.map((row) => row.name), ['Jane', 'Bob']);
  assert.deepEqual(result.emailKeys, ['jane@acme.co', 'bob@acme.co']);
  assert.deepEqual(result.errors, [{ row: 2, error: 'duplicate_email', email: 'jane@acme.co' }]);
});

test('prepareContactImportRows keeps valid contacts that have no email', () => {
  const parsed = parseContactsCsv('name,role,email\nJane,procurement,\nBob,maintenance,bob@acme.co');
  const result = prepareContactImportRows(parsed, { companyId: 'co_1', actor: 'staff@masest.co' });

  assert.deepEqual(result.rows.map((row) => [row.name, row.email]), [['Jane', null], ['Bob', 'bob@acme.co']]);
  assert.deepEqual(result.emailKeys, ['bob@acme.co']);
  assert.deepEqual(result.errors, []);
});

test('prepareContactImportRows preserves validation errors with source row numbers', () => {
  const parsed = [
    { name: 'Jane', email: 'not-an-email' },
    { name: 'Bob', email: 'bob@acme.co' },
  ];
  const result = prepareContactImportRows(parsed, { companyId: 'co_1', actor: 'staff@masest.co' });

  assert.deepEqual(result.rows.map((row) => row.name), ['Bob']);
  assert.deepEqual(result.emailKeys, ['bob@acme.co']);
  assert.deepEqual(result.errors, [{ row: 1, error: 'invalid_email' }]);
});

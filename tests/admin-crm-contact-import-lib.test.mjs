import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContactsCsv } from '../functions/_lib/crm-contacts.js';

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

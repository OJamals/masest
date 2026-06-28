// Unit tests for escapeLike (pure behavioral) + source-contract that timeline.js
// imports and uses it at both ilike call sites.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { escapeLike } from '../functions/_lib/crm.js';

// --- behavioral unit tests ---

test('escapeLike passes metacharacter-free strings through unchanged', () => {
  assert.equal(escapeLike('Acme Corp'), 'Acme Corp');
  assert.equal(escapeLike('hello'), 'hello');
  assert.equal(escapeLike('buyer@example.com'), 'buyer@example.com');
});

test('escapeLike escapes percent', () => {
  assert.equal(escapeLike('100%'), '100\\%');
});

test('escapeLike escapes underscore', () => {
  assert.equal(escapeLike('john_doe@x.com'), 'john\\_doe@x.com');
});

test('escapeLike escapes backslash', () => {
  assert.equal(escapeLike('C:\\path'), 'C:\\\\path');
});

test('escapeLike escapes combined metacharacters: a_b%c\\d → a\\_b\\%c\\\\d', () => {
  assert.equal(escapeLike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
});

test('escapeLike returns empty string for null', () => {
  assert.equal(escapeLike(null), '');
});

test('escapeLike returns empty string for undefined', () => {
  assert.equal(escapeLike(undefined), '');
});

test('escapeLike coerces non-string values', () => {
  assert.equal(escapeLike(42), '42');
  assert.equal(escapeLike(true), 'true');
});

// --- source-contract: timeline.js imports and uses escapeLike ---

const TIMELINE = readFileSync(new URL('../functions/api/admin/crm/timeline.js', import.meta.url), 'utf8');

test('timeline.js imports escapeLike from _lib/crm.js', () => {
  assert.match(TIMELINE, /escapeLike/);
  assert.match(TIMELINE, /from '\.\.\/\.\.\/\.\.\/_lib\/crm\.js'/);
});

test('timeline.js uses escapeLike on the company ilike (exact match, no surrounding %)', () => {
  assert.match(TIMELINE, /\.ilike\('company',\s*escapeLike\(name\)\)/);
});

test('timeline.js uses escapeLike on the to_email ilike (contains, addr wrapped in %)', () => {
  assert.match(TIMELINE, /\.ilike\('to_email',\s*`%\$\{escapeLike\(addr\)\}%`\)/);
});

// Unit tests for escapeLike (pure behavioral) + source-contract that the activity store
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

// --- source-contract: crm-activity.js imports and uses escapeLike ---

const ACTIVITY = readFileSync(new URL('../functions/_lib/crm-activity.js', import.meta.url), 'utf8');

test('crm-activity.js imports escapeLike from crm.js', () => {
  assert.match(ACTIVITY, /escapeLike/);
  assert.match(ACTIVITY, /from '\.\/crm\.js'/);
});

test('activity store uses escapeLike on the company ilike (exact match, no surrounding %)', () => {
  assert.match(ACTIVITY, /\.ilike\('company',\s*escapeLike\(companyName\)\)/);
});

test('activity store uses escapeLike on the to_email ilike (contains, address wrapped in %)', () => {
  assert.match(ACTIVITY, /\.ilike\('to_email',\s*`%\$\{escapeLike\(address\)\}%`\)/);
});

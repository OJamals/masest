// Staff role tiers batch 2 (#21): read_only staff blocked from ALL admin mutations.
// Baseline staffCanWrite(role) on every mutation path; fine-grained staffCan() still
// narrows the dangerous actions (covered in staff-roles.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { staffCanWrite } from '../functions/_lib/authz.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('staffCanWrite blocks only read_only', () => {
  assert.equal(staffCanWrite('read_only'), false);
  for (const r of ['owner', 'finance', 'support']) assert.equal(staffCanWrite(r), true, r);
});

// Mutation endpoints that must enforce the read_only baseline.
// (companies.js + products.js already exclude read_only via their fine staffCan gates.)
const MUTATION_ENDPOINTS = [
  'functions/api/admin/orders.js',
  'functions/api/admin/users.js',
  'functions/api/admin/messages.js',
  'functions/api/admin/offers.js',
  'functions/api/admin/quotes.js',
  'functions/api/admin/variant-pricing.js',
  'functions/api/admin/product-image.js',
  'functions/api/admin/qbo/retry.js',
  'functions/api/admin/qbo/sync.js',
  'functions/api/admin/qbo/connect.js',
  'functions/api/admin/newsletters.js',
  'functions/api/admin/recipients.js',
];

for (const path of MUTATION_ENDPOINTS) {
  test(`${path} enforces the read_only write baseline`, () => {
    const src = read(path);
    assert.match(src, /import\s*\{[^}]*staffCanWrite[^}]*\}\s*from\s*['"][^'"]*authz\.js['"]/, 'must import staffCanWrite');
    assert.match(src, /staffCanWrite\(\s*role\s*\)/, 'must check staffCanWrite(role)');
  });
}

test('recipients uses one shared write gate before body parsing', () => {
  const src = read('functions/api/admin/recipients.js');
  const writeGate = "if (request.method !== 'POST')";
  const methodIndex = src.indexOf(writeGate);
  const guardIndex = src.indexOf('staffCanWrite(role)', methodIndex);
  const parserIndex = src.indexOf('readBody(request)', methodIndex);

  assert.ok(methodIndex >= 0, 'must preserve the POST method boundary');
  assert.ok(guardIndex > methodIndex, 'write gate must follow the POST method boundary');
  assert.ok(parserIndex > guardIndex, 'write gate must run before body parsing');
  assert.equal(src.match(/staffCanWrite\(\s*role\s*\)/g)?.length, 1, 'all recipient writes must share one gate');
});

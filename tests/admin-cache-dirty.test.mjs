// #28 — admin UX: cached tab state + in-memory search + dirty-edit guard.
// Pure dirty-tracking lives in js/admin/edits.js; admin.js wires cache + in-memory
// search + capture/restore so a sibling save or cache re-render never wipes edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { editKey, editSelector, captureDirty, restoreDirty } from '../js/admin/edits.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal element stub mirroring the DOM surface editKey touches.
function el({ dataset = {}, attrs = [], value = '', product, vsku } = {}) {
  return {
    dataset,
    value,
    attributes: attrs.map(([name, v]) => ({ name, value: v })),
    closest(sel) {
      if (sel === '[data-product]' && product) return { dataset: { product } };
      if (sel === '[data-vsku]' && vsku) return { dataset: { vsku } };
      if (sel === '[data-variant]' && this._variant) return { dataset: { variant: this._variant } };
      return null;
    },
  };
}
function variantEl(vfield, variant, value = '') {
  const e = el({ dataset: { vfield }, value });
  e._variant = variant;
  return e;
}

test('editKey scopes repeated product data-field by row sku (no cross-row collision)', () => {
  const a = el({ dataset: { field: 'price' }, product: 'sku-1' });
  const b = el({ dataset: { field: 'price' }, product: 'sku-2' });
  assert.equal(editKey(a), 'f:sku-1:price');
  assert.equal(editKey(b), 'f:sku-2:price');
  assert.notEqual(editKey(a), editKey(b)); // same attr, different rows → distinct keys
});

test('editKey scopes repeated pricing data-price-tier by row vsku', () => {
  const a = el({ dataset: { priceTier: 'hvac' }, vsku: 'VK-1' });
  const b = el({ dataset: { priceTier: 'hvac' }, vsku: 'VK-2' });
  assert.equal(editKey(a), 'p:VK-1:hvac');
  assert.notEqual(editKey(a), editKey(b));
});

test('editKey scopes repeated variant data-vfield by row vsku', () => {
  assert.equal(editKey(variantEl('price', 'VK-A')), 'v:VK-A:price');
  assert.notEqual(editKey(variantEl('price', 'VK-A')), editKey(variantEl('price', 'VK-B')));
  assert.equal(editSelector('v:VK-A:price'), '[data-variant="VK-A"] [data-vfield="price"]');
});

test('editKey uses the id-bearing data attr directly for unique controls', () => {
  assert.equal(editKey(el({ attrs: [['data-net', 'c-9']] })), 'a:data-net:c-9');
  assert.equal(editKey(el({ attrs: [['data-order-status', 'o-3']] })), 'a:data-order-status:o-3');
});

test('editKey ignores data-dirty and returns null when nothing identifies the control', () => {
  assert.equal(editKey(el({ attrs: [['data-dirty', '1']] })), null);
  assert.equal(editKey(el({ attrs: [['class', 'x']] })), null);
});

test('editSelector round-trips each key kind to a queryable selector', () => {
  assert.equal(editSelector('f:sku-1:price'), '[data-product="sku-1"] [data-field="price"]');
  assert.equal(editSelector('p:VK-1:hvac'), '[data-vsku="VK-1"] [data-price-tier="hvac"]');
  assert.equal(editSelector('a:data-net:c-9'), '[data-net="c-9"]');
});

test('captureDirty snapshots only dirty controls, keyed by editKey', () => {
  const dirty = [
    el({ attrs: [['data-net', 'c-1']], value: '5000' }),
    el({ dataset: { field: 'price' }, product: 'sku-2', value: '12.50' }),
  ];
  const box = { querySelectorAll: (sel) => (sel === '[data-dirty="1"]' ? dirty : []) };
  assert.deepEqual(captureDirty(box), { 'a:data-net:c-1': '5000', 'f:sku-2:price': '12.50' });
});

test('captureDirty on a missing box yields an empty snapshot', () => {
  assert.deepEqual(captureDirty(null), {});
});

test('restoreDirty writes snapshot values back and re-marks dirty, skipping unchanged', () => {
  const sibling = { value: '', dataset: {} };       // user-typed-then-clobbered → restore
  const saved = { value: '5000', dataset: {} };     // server already matches → leave alone
  const box = {
    querySelector: (sel) => ({
      '[data-net="c-2"]': sibling,
      '[data-net="c-1"]': saved,
    }[sel] || null),
  };
  restoreDirty(box, { 'a:data-net:c-2': '3000', 'a:data-net:c-1': '5000' });
  assert.equal(sibling.value, '3000');
  assert.equal(sibling.dataset.dirty, '1');
  assert.equal(saved.dataset.dirty, undefined); // unchanged → not re-marked
});

test('restoreDirty tolerates a missing target element', () => {
  const box = { querySelector: () => null };
  assert.doesNotThrow(() => restoreDirty(box, { 'a:data-net:gone': '9' }));
});

// ---- source-contract wiring in admin.js ----
const admin = readFileSync(join(root, 'js/admin.js'), 'utf8');

test('admin.js imports the dirty-tracking helpers', () => {
  assert.match(admin, /from '\.\/admin\/edits\.js'/);
  assert.match(admin, /captureDirty/);
  assert.match(admin, /restoreDirty/);
});

test('search inputs filter in memory (refetch:false), not refetch per keystroke', () => {
  assert.match(admin, /ordSearch'\)\.addEventListener\('input', debounce\(\(\) => renderOrders\(\{ refetch: false \}\)\)\)/);
  assert.match(admin, /coSearch'\)\.addEventListener\('input', debounce\(\(\) => renderCompanies\(\{ refetch: false \}\)\)\)/);
  assert.match(admin, /prodSearch'\)\.addEventListener\('input', debounce\(\(\) => renderProducts\(\{ refetch: false \}\)\)\)/);
  assert.match(admin, /qSearch'\)\.addEventListener\('input', debounce\(\(\) => renderQuotePipeline\(\{ refetch: false \}\)\)\)/);
});

test('list renderers gate the fetch on a refetch flag', () => {
  assert.match(admin, /async function renderOrders\(\{ append = false, refetch = true \} = \{\}\)/);
  assert.match(admin, /async function renderCompanies\(\{ append = false, refetch = true \} = \{\}\)/);
  assert.match(admin, /async function renderProducts\(\{ refetch = true \} = \{\}\)/);
});

test('setTab renders cached tabs from memory instead of refetching', () => {
  assert.match(admin, /state\.loaded\.has\(state\.tab\)/);
  assert.match(admin, /refetch: !cached/);
});

test('renderers mark their dataset loaded so revisits hit the cache', () => {
  assert.match(admin, /state\.loaded\.add\('orders'\)/);
  assert.match(admin, /state\.loaded\.add\('companies'\)/);
});

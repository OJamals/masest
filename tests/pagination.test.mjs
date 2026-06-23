// Offset/limit pagination for list endpoints (#29): shared helper + endpoint/client wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parsePage, pageEnvelope } from '../functions/_lib/paginate.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- parsePage ----
test('parsePage returns defaults when params are absent', () => {
  assert.deepEqual(parsePage(new URLSearchParams(''), { defaultLimit: 25, maxLimit: 100 }), { limit: 25, offset: 0 });
});

test('parsePage reads limit + offset', () => {
  assert.deepEqual(parsePage(new URLSearchParams('limit=10&offset=20'), { defaultLimit: 25, maxLimit: 100 }), { limit: 10, offset: 20 });
});

test('parsePage clamps limit to maxLimit', () => {
  assert.equal(parsePage(new URLSearchParams('limit=9999'), { defaultLimit: 25, maxLimit: 100 }).limit, 100);
});

test('parsePage ignores junk / zero / negative values', () => {
  assert.deepEqual(parsePage(new URLSearchParams('limit=abc&offset=xyz'), { defaultLimit: 25, maxLimit: 100 }), { limit: 25, offset: 0 });
  assert.deepEqual(parsePage(new URLSearchParams('limit=-5&offset=-3'), { defaultLimit: 25, maxLimit: 100 }), { limit: 25, offset: 0 });
  assert.deepEqual(parsePage(new URLSearchParams('limit=0'), { defaultLimit: 25, maxLimit: 100 }), { limit: 25, offset: 0 });
});

// ---- pageEnvelope ----
test('pageEnvelope reports total + has_more from an exact count', () => {
  const e = pageEnvelope(new Array(25), { limit: 25, offset: 0, count: 80 });
  assert.equal(e.total, 80);
  assert.equal(e.limit, 25);
  assert.equal(e.offset, 0);
  assert.equal(e.has_more, true);
});

test('pageEnvelope has_more is false on the last page', () => {
  const e = pageEnvelope(new Array(5), { limit: 25, offset: 75, count: 80 });
  assert.equal(e.has_more, false);
  assert.equal(e.total, 80);
});

test('pageEnvelope falls back to a full-page heuristic when count is null', () => {
  assert.equal(pageEnvelope(new Array(25), { limit: 25, offset: 0, count: null }).has_more, true);
  assert.equal(pageEnvelope(new Array(10), { limit: 25, offset: 0, count: null }).has_more, false);
  assert.equal(pageEnvelope([], { limit: 25, offset: 0, count: null }).has_more, false);
});

// ---- endpoint wiring (source contracts) ----
for (const [path, defLimit] of [
  ['functions/api/account/orders.js', 25],
  ['functions/api/account/notifications.js', 50],
  ['functions/api/admin/orders.js', 100],
]) {
  test(`${path} paginates with parsePage + .range + exact count`, () => {
    const src = read(path);
    assert.match(src, /parsePage\(/, 'must parse limit/offset via parsePage');
    assert.match(src, /\.range\(\s*offset\s*,/, 'must use .range(offset, ...)');
    assert.match(src, /count:\s*'exact'/, 'must request an exact total count');
    assert.match(src, /pageEnvelope\(/, 'must return the pagination envelope');
  });
}

// ---- client load-more UI ----
test('admin orders list exposes a Load more control', () => {
  assert.match(read('js/admin/orders.js'), /data-load-more-orders/); // Orders tab moved in #36
});

test('dashboard orders + notifications lists expose Load more controls', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /data-load-more-orders/);
  assert.match(src, /data-load-more-notifs/);
});

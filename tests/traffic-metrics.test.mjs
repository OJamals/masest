import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTrafficWindow, trafficMetrics } from '../functions/_lib/traffic-metrics.js';

test('pageviews and distinct sessions exclude other event rows', () => {
  const result = trafficMetrics([
    { event: 'pageview', visitor: 'a' },
    { event: 'pageview', visitor: 'a' },
    { event: null, visitor: 'b' },
    { event: 'pageview', visitor: null },
    { event: 'checkout_start', visitor: 'event-only' },
    { event: 'quote_submit', visitor: 'a' },
  ]);
  assert.equal(result.pageviews.length, 4);
  assert.equal(result.unique, 2);
  assert.equal(result.counts.quote_submit, 1);
  assert.equal(result.counts.checkout_start, 1);
});

test('event-only and empty windows do not manufacture views or visitors', () => {
  for (const rows of [[], [{ event: 'quote_submit', visitor: 'a' }]]) {
    const result = trafficMetrics(rows);
    assert.equal(result.pageviews.length, 0);
    assert.equal(result.unique, 0);
  }
});

function database(rows, { cap = 1000, error = null } = {}) {
  const ranges = [];
  const orders = [];
  return {
    ranges, orders,
    from(table) {
      assert.equal(table, 'page_views');
      let selected = rows;
      return {
        select(_columns, options) { assert.equal(options.count, 'exact'); return this; },
        gte(_key, value) { selected = selected.filter((row) => row.created_at >= value); return this; },
        lt(_key, value) { selected = selected.filter((row) => row.created_at < value); return this; },
        order(key) { orders.push(key); return this; },
        async range(from, to) {
          ranges.push([from, to]);
          return { data: selected.slice(from, Math.min(to + 1, from + cap)), count: selected.length, error };
        },
      };
    },
  };
}

const rows = Array.from({ length: 2505 }, (_, i) => ({ created_at: '2026-09-27', visitor: String(i), event: 'pageview' }));

test('paginates beyond the database response cap without double-counting', async () => {
  const sb = database(rows);
  const result = await loadTrafficWindow(sb, '2026-09-01', '2026-09-28');
  assert.equal(result.rows.length, 2505);
  assert.equal(result.matched, 2505);
  assert.equal(result.truncated, false);
  assert.equal(trafficMetrics(result.rows).unique, 2505);
  assert.deepEqual(sb.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.deepEqual(sb.orders, ['created_at', 'id', 'created_at', 'id', 'created_at', 'id']);
});

test('uses actual returned row count when server cap is below requested page size', async () => {
  const sb = database(rows.slice(0, 7), { cap: 3 });
  const result = await loadTrafficWindow(sb, '2026-09-01', '2026-09-28');
  assert.equal(result.rows.length, 7);
  assert.deepEqual(sb.ranges.map(([offset]) => offset), [0, 3, 6]);
});

test('bounded scans disclose truncation and keep a fixed exclusive end time', async () => {
  const sb = database([...rows, { created_at: '2026-09-28', event: 'pageview' }]);
  const result = await loadTrafficWindow(sb, '2026-09-01', '2026-09-28', 1200);
  assert.equal(result.rows.length, 1200);
  assert.equal(result.matched, 2505);
  assert.equal(result.truncated, true);
});

test('database errors are unavailable data, not a successful empty window', async () => {
  await assert.rejects(loadTrafficWindow(database([], { error: new Error('unavailable') }), '2026-09-01', '2026-09-28'), /unavailable/);
});

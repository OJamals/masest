// UX + optimize batch (issues #38, #34, #32).
//   #38 — admin stats revenue/AOV/order-count come from a DB-side aggregate over the
//         full orders table, not a 1000-row sample that silently undercounts.
//   #34 — the shared api() refreshes + retries once on 401, then emits
//         'masest:session-expired'; dashboard + admin react instead of failing silently.
//   #32 — admin search inputs are debounced (no fetch+rerender per keystroke).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- #38: stats aggregate ----
test('admin_order_metrics migration aggregates DB-side over the full orders table', () => {
  const sql = read('supabase/schema-admin-stats.sql');
  assert.match(sql, /function\s+public\.admin_order_metrics/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /sum\(total\)/i, 'must sum revenue in SQL, not sample it in JS');
  assert.match(sql, /grant\s+execute[\s\S]*admin_order_metrics[\s\S]*service_role/i);
});

test('stats.js prefers the aggregate RPC and stops reporting the sampled revenue as total', () => {
  const src = read('functions/api/admin/stats.js');
  assert.match(src, /\.rpc\(\s*'admin_order_metrics'\s*\)/, 'must call the aggregate RPC');
  assert.match(src, /metrics\s*\?\s*Number\(metrics\.revenue_total\)/, 'revenue total must come from the aggregate when present');
  assert.match(src, /revenue:\s*revenueTotal/, 'the returned revenue must be the aggregate total, not the sample');
});

// ---- #34: session-expiry handling ----
test('api() refreshes and retries once on 401, then emits session-expired', () => {
  const src = read('js/auth.js');
  assert.match(src, /r\.status\s*===\s*401\s*&&\s*!_retried\s*&&\s*await\s+refreshSession\(\)/, 'must refresh+retry once on 401');
  assert.match(src, /masest:session-expired/, 'must broadcast a session-expired event');
});

for (const path of ['js/dashboard.js', 'js/admin.js']) {
  test(`${path} reacts to masest:session-expired`, () => {
    assert.match(read(path), /addEventListener\(\s*'masest:session-expired'/, 'must listen for the session-expired event');
  });
}

test('dashboard stops the live poller when the session expires', () => {
  const src = read('js/dashboard.js');
  const handlerIdx = src.indexOf("'masest:session-expired'");
  assert.ok(handlerIdx > 0);
  assert.match(src.slice(handlerIdx, handlerIdx + 300), /clearInterval\(\s*pollTimer\s*\)/, 'must clear the poll interval');
});

// ---- #32: debounced admin search ----
test('admin defines a debounce helper and applies it to every search input', () => {
  const src = read('js/admin.js');
  assert.match(src, /function\s+debounce\s*\(/, 'must define a debounce helper');
  for (const id of ['ordSearch', 'coSearch', 'prodSearch', 'priceSearch', 'qSearch', 'custSearch']) {
    const re = new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\(\\s*'input',\\s*debounce\\(`);
    assert.match(src, re, `${id} input must be debounced`);
  }
});

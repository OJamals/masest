import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as directory from '../functions/_lib/connected-staff-directory.js';
import { measureDirectory } from '../tools/measure-connected-directory.mjs';

test('real directory client bounds slow upstream and drains cancelled auth lookups', async () => {
  assert.equal(typeof directory.createConnectedStaffDirectory, 'function');
  const env = { SUPABASE_URL: 'https://directory.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key' };
  const report = await measureDirectory({ requests: 2, delayMs: 2, deadlineMs: 60, watchdogMs: 500,
    factory: (fetchImpl, timeoutMs) => directory.createConnectedStaffDirectory(env, { fetchImpl, timeoutMs }),
  });
  assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks));
  assert.equal(report.live_directory_verified, false);
  const stalled = report.scenarios[2];
  assert.equal(stalled.cancelled, 100);
  assert.equal(stalled.remaining_inflight, 0);
  assert.ok(stalled.max_ms < 400);
});

test('directory budget is shared across profile and auth', async () => {
  assert.equal(typeof directory.createConnectedStaffDirectory, 'function');
  const env = { SUPABASE_URL: 'https://directory.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key' };
  const target = '00000000-0000-4000-8000-000000000043'; const events = [];
  const client = directory.createConnectedStaffDirectory(env, { timeoutMs: 60, fetchImpl: async (input, init) => {
    events.push(new URL(input).pathname);
    if (events.length === 1) { await new Promise((resolve) => setTimeout(resolve, 40)); return Response.json({ id: target, is_staff: true, staff_role: 'support' }); }
    return new Promise((_resolve, reject) => { const abort = () => reject(init.signal.reason); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); });
  } });
  // Keep test event loop alive while the native timeout signal is unref'd.
  const watchdog = setTimeout(() => {}, 500);
  const started = performance.now();
  try { await assert.rejects(client.eligible(target)); }
  finally { clearTimeout(watchdog); }
  assert.equal(events.length, 2);
  assert.ok(performance.now() - started < 250);
});

test('cancelled caller and failed profile reads cannot start auth fan-out or retry', async () => {
  const env = { SUPABASE_URL: 'https://directory.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key' };
  let calls = 0; const controller = new AbortController(); controller.abort();
  const cancelled = directory.createConnectedStaffDirectory(env, { signal: controller.signal, fetchImpl: async () => { calls++; throw new Error('Unexpected fetch'); } });
  await assert.rejects(cancelled.list({ limit: 50 }));
  assert.equal(calls, 0);
  const unavailable = directory.createConnectedStaffDirectory(env, { fetchImpl: async () => { calls++; return Response.json({ message: 'Synthetic outage' }, { status: 503 }); } });
  await assert.rejects(unavailable.list({ limit: 50 }));
  assert.equal(calls, 1);
});

test('native fetch aborts a stalled response body and closes the owned socket', async () => {
  let closed = false;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('[');
    res.on('close', () => { closed = true; });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const env = { SUPABASE_URL: 'https://directory.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key' };
  try {
    const client = directory.createConnectedStaffDirectory(env, { timeoutMs: 100,
      fetchImpl: (input, init) => fetch(`http://127.0.0.1:${server.address().port}${new URL(input).pathname}`, init),
    });
    await assert.rejects(client.list({ limit: 50 }));
    for (let i = 0; i < 20 && !closed; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(closed, true);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

// Local synthetic upstream only. Never reads credentials or calls the network.
import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connectedStaffDirectory, createConnectedStaffDirectory } from '../functions/_lib/connected-staff-directory.js';

const env = { SUPABASE_URL: 'https://directory.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key' };
const staffId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const baseline = (fetchImpl) => connectedStaffDirectory(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl },
}), env);
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

export async function measureDirectory({ factory = (fetchImpl, timeoutMs) => createConnectedStaffDirectory(env, { fetchImpl, timeoutMs }), requests = 10, delayMs = 25, deadlineMs = 100, watchdogMs = 500 } = {}) {
  if (!Number.isInteger(requests) || requests < 1 || requests > 25 || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 100 || !Number.isFinite(deadlineMs) || deadlineMs <= delayMs || deadlineMs > 5000 || watchdogMs <= deadlineMs || watchdogMs > 10000) throw new Error('Invalid synthetic directory configuration');
  async function scenario(mode) {
    let inflight = 0; let peak = 0; let profiles = 0; let auth = 0; let cancelled = 0;
    const watchdogController = new AbortController();
    const watchdogTimer = setTimeout(() => watchdogController.abort(), watchdogMs);
    const watchdog = watchdogController.signal;
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input);
      if (url.origin !== env.SUPABASE_URL || (init.method && init.method !== 'GET')) throw new Error('Unexpected synthetic request');
      const isProfile = url.pathname === '/rest/v1/profiles';
      if (isProfile) profiles++; else if (url.pathname.startsWith('/auth/v1/admin/users/')) auth++; else throw new Error('Unexpected synthetic route');
      inflight++; peak = Math.max(peak, inflight);
      const signal = AbortSignal.any([watchdog, ...(init.signal ? [init.signal] : [])]);
      try {
        await new Promise((resolve, reject) => {
          let timer;
          const abort = () => { clearTimeout(timer); cancelled++; reject(new Error('Synthetic upstream aborted')); };
          if (signal.aborted) return abort();
          signal.addEventListener('abort', abort, { once: true });
          if (mode !== 'stalled' || isProfile) timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delayMs);
        });
        if (mode === 'failure' && !isProfile) return Response.json({ message: 'Synthetic auth unavailable' }, { status: 503 });
        if (isProfile) {
          const count = Number(url.searchParams.get('limit'));
          if (count !== 51) throw new Error('Directory query not bounded at 51');
          return Response.json(Array.from({ length: count }, (_, n) => ({ id: staffId(n + 1), is_staff: true, staff_role: 'support', full_name: 'Synthetic staff' })));
        }
        return Response.json({ user: { id: url.pathname.split('/').at(-1), email: 'staff@example.test' } });
      } finally { inflight--; }
    };
    const results = await Promise.all(Array.from({ length: requests }, async () => {
      const start = performance.now();
      try {
        const page = await factory(fetchImpl, deadlineMs).list({ limit: 50 });
        if (page.items.length !== 50 || page.next_cursor !== staffId(50)) throw new Error('Invalid synthetic page');
        return { ok: true, elapsed_ms: performance.now() - start };
      } catch { return { ok: false, elapsed_ms: performance.now() - start }; }
    }));
    // Promise.all may reject on one auth response before siblings drain.
    const drainUntil = performance.now() + watchdogMs;
    while (inflight && performance.now() < drainUntil) await new Promise((resolve) => setTimeout(resolve, 5));
    clearTimeout(watchdogTimer);
    return { mode, requests, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length,
      p95_ms: percentile(results.map((r) => r.elapsed_ms), .95), max_ms: Math.max(...results.map((r) => r.elapsed_ms)),
      profile_requests: profiles, auth_requests: auth, peak_inflight: peak, cancelled, remaining_inflight: inflight,
      harness_watchdog_used: watchdog.aborted };
  }
  const scenarios = [];
  for (const mode of ['healthy', 'failure', 'stalled']) scenarios.push(await scenario(mode));
  return { scope: 'local_synthetic_directory_upstream', live_directory_verified: false, requests, delay_ms: delayMs, deadline_ms: deadlineMs, watchdog_ms: watchdogMs, scenarios,
    checks: { healthy_pages: scenarios[0].succeeded === requests, failure_closed: scenarios[1].failed === requests,
      stalled_bounded_by_adapter: scenarios[2].failed === requests && !scenarios[2].harness_watchdog_used,
      upstream_calls_accounted: scenarios.every((r) => r.profile_requests === requests && r.auth_requests === requests * 50 && r.remaining_inflight === 0),
      healthy_p95_under_250ms: scenarios[0].p95_ms < 250 } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--fixture-benchmark' || !process.argv[3]) throw new Error('Usage: node tools/measure-connected-directory.mjs --fixture-benchmark OUTPUT');
  const report = await measureDirectory(process.argv.includes('--baseline') ? { factory: baseline } : {});
  report.policy = process.argv.includes('--baseline') ? 'unbounded_baseline' : 'bounded_directory';
  report.production_timeout_ms = process.argv.includes('--baseline') ? null : 5000;
  report.adapter_sha256 = createHash('sha256').update(readFileSync(new URL('../functions/_lib/connected-staff-directory.js', import.meta.url))).digest('hex');
  report.supabase_version = JSON.parse(readFileSync(new URL('../node_modules/@supabase/supabase-js/package.json', import.meta.url))).version;
  writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: process.argv[3], checks: report.checks }));
  process.exitCode = Object.values(report.checks).every(Boolean) ? 0 : 1;
}

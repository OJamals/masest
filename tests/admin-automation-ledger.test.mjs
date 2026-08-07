import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  AUTOMATION_JOBS,
  recordAutomationRun,
  summarizeAutomationRuns,
  automationAttentionCount,
} from '../functions/_lib/automation-runs.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Minimal supabase double: captures inserts, or throws if `failing`. */
function fakeSb({ failing = false } = {}) {
  const inserts = [];
  return {
    inserts,
    from() {
      return {
        insert(row) {
          if (failing) return Promise.reject(new Error('relation "automation_runs" does not exist'));
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test('recording never changes the outcome of the job it observes', async () => {
  // The whole point: a ledger that can break a sweep is worse than no ledger.
  const sb = fakeSb({ failing: true });
  const result = await recordAutomationRun(sb, 'quote_sweep', async () => ({ ok: true, processed: 3 }));
  assert.deepEqual(result, { ok: true, processed: 3 }, 'a failed ledger write must not alter the result');

  await assert.rejects(
    recordAutomationRun(sb, 'quote_sweep', async () => { throw new Error('sweep_exploded'); }),
    /sweep_exploded/,
    'the original error must propagate unchanged',
  );
});

test('a run records outcome and item count', async () => {
  const sb = fakeSb();
  await recordAutomationRun(sb, 'review_reminders', async () => ({ ok: true, sent: 7 }));
  assert.equal(sb.inserts.length, 1);
  assert.equal(sb.inserts[0].job, 'review_reminders');
  assert.equal(sb.inserts[0].ok, true);
  assert.equal(sb.inserts[0].processed, 7);
  assert.equal(sb.inserts[0].error_code, null);
});

test('failures are recorded as codes, never as messages', async () => {
  const sb = fakeSb();
  // A sweep that returns ok:false failed without throwing.
  await recordAutomationRun(sb, 'blog_newsletter', async () => ({ ok: false, error: 'load_failed' }));
  assert.equal(sb.inserts[0].ok, false);
  assert.equal(sb.inserts[0].error_code, 'load_failed');

  await assert.rejects(recordAutomationRun(sb, 'qbo_sync', async () => {
    throw Object.assign(new Error('customer bob@example.com rejected by intuit'), { code: 'qbo_rejected' });
  }));
  assert.equal(sb.inserts[1].error_code, 'qbo_rejected');
  assert.doesNotMatch(JSON.stringify(sb.inserts[1]), /bob@example\.com/, 'error detail must not reach the ledger');
});

test('a Response result derives success from its status', async () => {
  const sb = fakeSb();
  await recordAutomationRun(sb, 'newsletter_sweep', async () => new Response('{}', { status: 500 }));
  assert.equal(sb.inserts[0].ok, false);
  assert.equal(sb.inserts[0].error_code, 'http_500');

  await recordAutomationRun(sb, 'newsletter_sweep', async (run) => {
    run.processed = 4;
    return new Response('{}', { status: 200 });
  });
  assert.equal(sb.inserts[1].ok, true);
  assert.equal(sb.inserts[1].processed, 4);
});

test('a job that never reported is surfaced, not omitted', () => {
  // The case the console could not see before: cron never applied, or the job
  // fails before it can even record.
  const summary = summarizeAutomationRuns([]);
  assert.equal(summary.length, AUTOMATION_JOBS.length);
  assert.ok(summary.every((entry) => entry.state === 'never'));
  assert.equal(automationAttentionCount(summary), AUTOMATION_JOBS.length);
});

test('staleness is measured against each job own cadence', () => {
  const now = new Date('2026-08-06T12:00:00Z');
  const ago = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();

  const summary = summarizeAutomationRuns([
    { job: 'content_publish', started_at: ago(6), ok: true, processed: 1 },     // 5-min job, fresh
    { job: 'content_publish', started_at: ago(6), ok: true, processed: 1 },
    { job: 'qbo_sync', started_at: ago(60 * 5), ok: true, processed: 0 },       // hourly job, stale
    { job: 'quote_sweep', started_at: ago(5), ok: false, error_code: 'load_failed' },
  ], now);
  const byJob = Object.fromEntries(summary.map((entry) => [entry.job, entry]));

  assert.equal(byJob.content_publish.state, 'ok', 'within two intervals is not stale');
  assert.equal(byJob.qbo_sync.state, 'stale');
  assert.equal(byJob.quote_sweep.state, 'failing', 'a recent failure outranks freshness');
  assert.equal(byJob.review_reminders.state, 'never');
});

test('every scheduled job records to the ledger', () => {
  // Eight jobs run this site; before the ledger only one was observable.
  const wired = [
    ['functions/api/admin/content.js', 'content_publish'],
    ['functions/api/admin/crm/tasks.js', 'crm_task_digest'],
    ['functions/api/admin/review-reminders.js', 'review_reminders'],
    ['functions/api/admin/quotes.js', 'quote_sweep'],
    ['functions/api/admin/newsletters.js', 'newsletter_sweep'],
    ['functions/api/admin/blog-newsletter.js', 'blog_newsletter'],
    ['functions/api/qbo-sync.js', 'qbo_sync'],
    ['functions/api/admin/integration-effects.js', 'integration_effects'],
  ];
  for (const [path, job] of wired) {
    const source = read(path);
    assert.match(source, /recordAutomationRun/, `${path} should record its run`);
    assert.match(source, new RegExp(`'${job}'`), `${path} should record as ${job}`);
  }
  assert.equal(wired.length, AUTOMATION_JOBS.length, 'every known job is wired');
});

test('the admin surface degrades when the ledger schema is absent', () => {
  const api = read('functions/api/admin/automation.js');
  assert.match(api, /if \(!user\) return json\(401/);
  assert.match(api, /if \(!staff\) return json\(403/);
  assert.match(api, /needs_migration: true/);
  assert.match(read('functions/api/admin/stats.js'), /keep attention at 0 rather than failing the whole snapshot/);

  const ui = read('js/admin/automation.js');
  assert.match(ui, /apply supabase\/schema-automation-runs\.sql/);
  assert.match(read('admin.html'), /id="admAutomation"/);
  assert.match(read('js/admin.js'), /createAutomationCard/);
});

test('the ledger schema is additive, granted, and bounded', () => {
  const sql = read('supabase/schema-automation-runs.sql');
  assert.match(sql, /create table if not exists public\.automation_runs/);
  assert.match(sql, /grant all privileges on table public\.automation_runs to service_role/, 'pooler tables need explicit grants');
  assert.match(sql, /alter table public\.automation_runs enable row level security/);
  assert.match(sql, /create or replace view public\.automation_run_latest/);
  assert.match(sql, /interval '30 days'/, 'operational signal, not an archive');
});

test('the publish sweep runs exactly once per request', () => {
  // The recorder wraps the call; an early draft invoked publishScheduled twice.
  const source = read('functions/api/admin/content.js');
  const publishCalls = source.match(/publishScheduled\(\{ userId: null, system: true \}\)/g) || [];
  assert.equal(publishCalls.length, 1, 'scheduled publish must not be invoked more than once');
});

test('the Overview surfaces the work these jobs protect', () => {
  const admin = read('js/admin.js');
  assert.match(admin, /\['Overdue follow-ups'[^\]]*\{ tab: 'crm' \}\]/);
  assert.match(admin, /\['Scheduled past due'[^\]]*\{ tab: 'integrations' \}\]/);
  assert.match(admin, /\['Automations needing attention'[^\]]*\{ tab: 'integrations' \}\]/);
  const stats = read('functions/api/admin/stats.js');
  assert.match(stats, /schedule_overdue: contentScheduleOverdue/);
  assert.match(stats, /count\('content_entries', \(q\) => q\.eq\('status', 'scheduled'\)\.lte\('scheduled_at', nowIso\)\)/);
});

test('the ledger module is not an admin-graph module needing release stamps', () => {
  // It lives in functions/_lib, so it is server-side and outside the browser
  // release-token contract that admin-split.test.mjs enforces.
  assert.ok(!readdirSync(new URL('../js/admin/', import.meta.url)).includes('automation-runs.js'));
});

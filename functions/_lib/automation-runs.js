/* Automation run ledger.
 *
 * Every scheduled job on this site was previously write-only: it did its work
 * and left no trace, so "did the review-reminder sweep run last night?" was
 * unanswerable from the console, and a cron that was never applied looked
 * exactly like one that runs perfectly.
 *
 * Contract: recording is best-effort and must NEVER change the outcome of the
 * job it observes. Every write here is wrapped — a missing table (schema not yet
 * applied), a permissions error, or a network blip degrades to "no ledger row",
 * never to a failed sweep.
 */

/** Jobs this console expects to run, with the cadence their cron template sets.
 *  expectedMinutes drives staleness: a job whose last run is older than a couple
 *  of intervals is reported stale, which is what catches a cron that was never
 *  applied or whose secret drifted. */
export const AUTOMATION_JOBS = [
  { job: 'content_publish', label: 'Scheduled content publish', expectedMinutes: 5 },
  { job: 'integration_effects', label: 'Provider effect queue', expectedMinutes: 5 },
  { job: 'quote_sweep', label: 'Quote follow-up sweep', expectedMinutes: 60 },
  { job: 'crm_task_digest', label: 'CRM follow-up digest', expectedMinutes: 60 * 24 },
  { job: 'review_reminders', label: 'Review reminder sweep', expectedMinutes: 60 * 24 },
  { job: 'newsletter_sweep', label: 'Newsletter campaign sweep', expectedMinutes: 60 },
  { job: 'blog_newsletter', label: 'Blog post newsletter', expectedMinutes: 60 },
  { job: 'qbo_sync', label: 'QuickBooks sync', expectedMinutes: 60 },
];

const JOB_NAMES = new Set(AUTOMATION_JOBS.map((entry) => entry.job));

/* Error codes only — never the message. A sweep failure can carry provider
 * detail or an address, and this table is read by the admin UI. */
function errorCode(error) {
  const raw = error?.code || error?.data?.error || error?.name || 'error';
  return String(raw).slice(0, 80).replace(/[^\w.:-]+/g, '_');
}

/** Count of work items a sweep reports, under any of the names they use. */
function processedCount(result) {
  const candidates = [result?.processed, result?.sent, result?.emailed, result?.published, result?.count, result?.updated];
  const found = candidates.find((value) => Number.isFinite(Number(value)));
  return Number.isFinite(Number(found)) ? Math.max(0, Math.trunc(Number(found))) : 0;
}

const isResponse = (value) => Boolean(value) && typeof value.status === 'number' && typeof value.headers === 'object';

/**
 * Run `work` and record one ledger row for it.
 * Returns exactly what `work` returns; rethrows exactly what `work` throws.
 *
 * `work` receives a run context whose `processed` a handler can set directly.
 * That exists so a sweep with early `return json(...)` branches can report its
 * count without being restructured — rewriting live sweep control flow to add
 * observability would be trading a real risk for a reporting nicety.
 */
export async function recordAutomationRun(sb, job, work) {
  if (!JOB_NAMES.has(job)) throw new Error(`unknown_automation_job:${job}`);
  const run = { processed: 0 };
  const startedAt = new Date().toISOString();
  let ok = false;
  let code = null;
  try {
    const result = await work(run);
    // A handler may return a Response (status decides) or a plain result object
    // (an explicit ok:false is a failure that did not throw).
    ok = isResponse(result) ? result.status < 400 : result?.ok !== false;
    if (!run.processed) run.processed = processedCount(result);
    if (!ok) code = isResponse(result) ? `http_${result.status}` : errorCode({ data: { error: result?.error } });
    return result;
  } catch (error) {
    code = errorCode(error);
    throw error;
  } finally {
    try {
      await sb.from('automation_runs').insert({
        job,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok,
        processed: Math.max(0, Math.trunc(Number(run.processed) || 0)),
        error_code: code,
      });
    } catch { /* the ledger is an observer; it never fails the observed job */ }
  }
}

/** Merge recorded runs onto the expected job list and flag staleness. */
export function summarizeAutomationRuns(rows = [], now = new Date()) {
  const byJob = new Map((rows || []).map((row) => [row.job, row]));
  return AUTOMATION_JOBS.map(({ job, label, expectedMinutes }) => {
    const run = byJob.get(job);
    if (!run) {
      // Never recorded a run at all: either the cron was never applied or the
      // job fails before it can even reach the ledger. Both need a human.
      return { job, label, expectedMinutes, state: 'never', last_run_at: null, processed: 0, error_code: null };
    }
    const lastRun = run.started_at ? new Date(run.started_at) : null;
    const ageMinutes = lastRun ? (now - lastRun) / 60000 : Infinity;
    // Two missed intervals (with a floor) before calling it stale, so ordinary
    // scheduler jitter does not read as an outage.
    const staleAfter = Math.max(expectedMinutes * 2, expectedMinutes + 10);
    const state = run.ok === false ? 'failing' : (ageMinutes > staleAfter ? 'stale' : 'ok');
    return {
      job,
      label,
      expectedMinutes,
      state,
      last_run_at: run.started_at || null,
      processed: Number(run.processed) || 0,
      error_code: run.error_code || null,
    };
  });
}

/** One number for the Overview: jobs needing attention. */
export function automationAttentionCount(summary = []) {
  return summary.filter((entry) => entry.state !== 'ok').length;
}

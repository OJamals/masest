// /api/admin/automation - last-run status for every scheduled job.
//
// Reads the ledger written by _lib/automation-runs.js and merges it onto the
// expected job list, so a job that has NEVER recorded a run is reported rather
// than simply absent — that case (cron never applied, or failing before it can
// record) is the one that used to be invisible.
import { adminClient, json, requireStaff } from '../../_lib/supabase.js';
import { summarizeAutomationRuns, automationAttentionCount } from '../../_lib/automation-runs.js';

const MISSING_TABLE = /does not exist|relation|schema cache/i;

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);
  const { data, error } = await sb
    .from('automation_run_latest')
    .select('job,started_at,finished_at,ok,processed,error_code');

  if (error) {
    // Schema not applied yet: report the expected jobs as never-run rather than
    // failing the panel, matching the CRM tables' needs_migration behaviour.
    if (MISSING_TABLE.test(error.message || '')) {
      const jobs = summarizeAutomationRuns([]);
      return json(200, { jobs, attention: automationAttentionCount(jobs), needs_migration: true });
    }
    return json(500, { error: error.message });
  }

  const jobs = summarizeAutomationRuns(data || []);
  return json(200, { jobs, attention: automationAttentionCount(jobs) });
}

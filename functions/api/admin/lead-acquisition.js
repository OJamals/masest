import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { loadLeadAcquisitionWindow, leadAcquisitionReport } from '../../_lib/lead-acquisition.js';

export async function onRequestGet({ request, env }, dependencies = {}) {
  const { user, staff } = await (dependencies.requireStaff
    ? dependencies.requireStaff(request, env)
    : requireStaff(request, env));
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '28', 10) || 28));
  const until = (dependencies.now ? dependencies.now() : new Date()).toISOString();
  const since = new Date(Date.parse(until) - days * 86400e3).toISOString();
  try {
    const sb = dependencies.adminClient ? dependencies.adminClient(env) : adminClient(env);
    const window = await (dependencies.loadWindow || loadLeadAcquisitionWindow)(sb, since, until);
    return json(200, {
      available: true, days, since, until,
      measurement_basis: 'durable_website_requests',
      stage_basis: 'current_state',
      matched: window.matched, scanned: window.rows.length, truncated: window.truncated,
      ...leadAcquisitionReport(window.rows, String(env.ADMIN_EMAILS || '').split(',')),
    }, { 'cache-control': 'no-store' });
  } catch {
    return json(503, { available: false, error: 'lead_report_unavailable' }, { 'cache-control': 'no-store' });
  }
}

export function createLeadAcquisitionHandler(dependencies = {}) {
  return (context) => onRequestGet(context, dependencies);
}

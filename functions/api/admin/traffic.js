// GET /api/admin/traffic?days=14 — first-party traffic aggregates from page_views. Staff-only.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '14', 10) || 14));
  const sinceIso = new Date(Date.now() - days * 86400e3).toISOString();

  const sb = adminClient(env);
  let rows = [];
  try {
    const { data, error } = await sb.from('page_views')
      .select('path,referrer,ua_family,visitor,created_at')
      .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(10000);
    if (error) throw error;
    rows = data || [];
  } catch {
    return json(200, { available: false, note: 'page_views not migrated yet — apply schema-phase5.sql.',
      total: 0, unique: 0, byDay: [], topPaths: [], topReferrers: [], byBrowser: [] });
  }

  const tally = (arr, key, transform) => {
    const m = {};
    for (const r of arr) { const k = transform ? transform(r[key]) : (r[key] || '—'); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, count: v }));
  };
  const dayMap = {};
  for (const r of rows) { const d = String(r.created_at).slice(0, 10); dayMap[d] = (dayMap[d] || 0) + 1; }
  const byDay = Object.entries(dayMap).sort().map(([day, count]) => ({ day, count }));
  const refHost = (r) => { if (!r) return 'direct'; try { return new URL(r).hostname.replace(/^www\./, ''); } catch { return 'other'; } };

  return json(200, {
    available: true, days, total: rows.length,
    unique: new Set(rows.map((r) => r.visitor).filter(Boolean)).size,
    byDay,
    topPaths: tally(rows, 'path').slice(0, 15),
    topReferrers: tally(rows, 'referrer', refHost).slice(0, 10),
    byBrowser: tally(rows, 'ua_family'),
  });
}

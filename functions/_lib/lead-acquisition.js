import { leadAttribution, leadAcquisitionLabel } from '../../js/lead-attribution.js';

export async function loadLeadAcquisitionWindow(sb, since, until, maxRows = 10000) {
  const rows = [];
  let matched = null;
  while (rows.length < maxRows) {
    const { data, error, count } = await sb.from('quotes')
      .select('id,created_at,source,type,status,pipeline_stage,email,payload,reporting_excluded', { count: 'exact' })
      .eq('source', 'contact').gte('created_at', since).lt('created_at', until)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(rows.length, Math.min(rows.length + 999, maxRows - 1));
    if (error) throw error;
    if (typeof count === 'number') matched = count;
    const page = data || [];
    rows.push(...page);
    if (!page.length || (matched !== null && rows.length >= matched)) break;
  }
  return { rows, matched, truncated: matched === null ? rows.length >= maxRows : rows.length < matched };
}

const emptyCounts = () => ({ requests: 0, phone: 0, email: 0, unknown_contact: 0, qualified: 0, proposal: 0, won: 0 });

function increment(counts, row) {
  counts.requests++;
  const preference = row.payload?.contact_preference || (row.type === 'callback' ? 'phone' : row.email ? 'email' : 'unknown_contact');
  counts[['phone', 'email'].includes(preference) ? preference : 'unknown_contact']++;
  if (['qualified', 'proposal', 'won'].includes(row.pipeline_stage)) counts[row.pipeline_stage]++;
}

export function leadAcquisitionReport(rows = [], staffEmails = []) {
  const staff = new Set(staffEmails.map((email) => String(email).trim().toLowerCase()).filter(Boolean));
  const excluded = { spam: 0, staff: 0, internal_test: 0 };
  const totals = emptyCounts();
  const sources = new Map();
  const pages = new Map();
  for (const row of rows) {
    if (row.source !== 'contact') continue;
    if (row.status === 'spam') { excluded.spam++; continue; }
    if (row.reporting_excluded === true) { excluded.internal_test++; continue; }
    if (staff.has(String(row.email || '').trim().toLowerCase())) { excluded.staff++; continue; }
    const attribution = leadAttribution(row);
    increment(totals, row);
    for (const [groups, key] of [[sources, leadAcquisitionLabel(attribution)], [pages, attribution?.landing_path || 'Unknown']]) {
      if (!groups.has(key)) groups.set(key, { key, ...emptyCounts() });
      increment(groups.get(key), row);
    }
  }
  const ranked = (groups) => [...groups.values()].sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
  return { totals, excluded, sources: ranked(sources).slice(0, 20), landing_pages: ranked(pages).slice(0, 20) };
}

// Admin traffic tab — first-party analytics report (#36 per-tab split).
// Self-contained: no shared admin state, self-fetches /api/admin/traffic. Shared
// primitives ($, api, admSkeleton, pct) are injected so this module stays a pure
// function of its dependencies.
import { esc } from '../util.js';

export function createTrafficRenderer({ $, api, admSkeleton, pct }) {
  function renderTrafficFunnel(funnel = []) {
    if (!funnel.length) return '<div class="adm-card"><h2>Funnel</h2><p class="muted">No funnel events yet.</p></div>';
    return `<div class="adm-card"><h2>Funnel</h2><table class="adm-mini-table"><tbody>${funnel.map((row) => `
      <tr><td>${esc(row.label || row.event)}</td><td class="num">${esc(row.count || 0)}</td><td class="num">${esc(pct(row.rate))}</td></tr>
    `).join('')}</tbody></table></div>`;
  }

  function renderTrafficCampaigns(topCampaigns = []) {
    if (!topCampaigns.length) return '<div class="adm-card"><h2>Campaigns</h2><p class="muted">No UTM campaigns recorded.</p></div>';
    return `<div class="adm-card"><h2>Campaigns</h2><table class="adm-mini-table"><tbody>${topCampaigns.map((row) => `
      <tr><td>${esc(row.key)}</td><td class="num">${esc(row.count)}</td></tr>
    `).join('')}</tbody></table></div>`;
  }

  function renderTrafficDays(byDay = []) {
    if (!byDay.length) return '<div class="adm-card"><h2>Daily trend</h2><p class="muted">No daily rows.</p></div>';
    return `<div class="adm-card"><h2>Daily trend</h2><table class="adm-mini-table"><thead><tr><th>Day</th><th>Views</th><th>Unique</th><th>Conversion events</th></tr></thead><tbody>${byDay.map((row) => `
      <tr><td>${esc(row.day)}</td><td class="num">${esc(row.pageviews ?? row.count ?? 0)}</td><td class="num">${esc(row.unique || 0)}</td><td class="num">${esc(row.conversion_events || 0)}</td></tr>
    `).join('')}</tbody></table></div>`;
  }

  function renderTrafficList(title, rows = []) {
    if (!rows.length) return `<div class="adm-card"><h2>${esc(title)}</h2><p class="muted">No rows.</p></div>`;
    return `<div class="adm-card"><h2>${esc(title)}</h2>${rows.map((row) => `<div class="dash-row"><span>${esc(row.key)}</span><b>${esc(row.count)}</b></div>`).join('')}</div>`;
  }

  return async function renderTraffic() {
    const box = $('admTraffic');
    box.innerHTML = admSkeleton();
    try {
      const data = await api('/api/admin/traffic?days=14');
      if (!data.available) {
        box.innerHTML = `<p class="muted">${esc(data.note || 'Traffic table not migrated yet.')}</p>`;
        return;
      }
      box.innerHTML = `<div class="adm-traffic-report">
        <div class="adm-grid">
          <div class="adm-card adm-stat"><i class="ph ph-eye"></i><b>${esc(data.total)}</b><span class="muted">Tracked events</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-users-three"></i><b>${esc(data.unique)}</b><span class="muted">Known visitors</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-arrow-square-out"></i><b>${esc((data.events || []).find((row) => row.key === 'quote_submit')?.count || 0)}</b><span class="muted">Quote submits</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-shopping-cart"></i><b>${esc((data.events || []).find((row) => row.key === 'checkout_start')?.count || 0)}</b><span class="muted">Checkout starts</span></div>
        </div>
        <div class="adm-report-grid">
          ${renderTrafficFunnel(data.funnel || [])}
          ${renderTrafficCampaigns(data.topCampaigns || [])}
          ${renderTrafficList('Top paths', data.topPaths || [])}
          ${renderTrafficList('Referrers', data.topReferrers || [])}
          ${renderTrafficList('Browsers', data.byBrowser || [])}
          ${renderTrafficDays(data.byDay || [])}
        </div>
      </div>`;
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load traffic. Reload to retry.</p>';
    }
  };
}

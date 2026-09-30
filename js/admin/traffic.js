// Admin traffic tab — first-party analytics report (#36 per-tab split).
// Self-contained: no shared admin state, self-fetches /api/admin/traffic. Shared
// primitives ($, api, admSkeleton, pct) are injected so this module stays a pure
// function of its dependencies.
import { esc } from '../util.js?v=20260929e';

export function renderLeadAcquisition(data) {
  if (!data?.available) return '<section class="adm-card"><h2>Website inquiries · last 28 days</h2><p class="adm-status" data-state="err">Saved inquiry report unavailable. Reload to retry.</p></section>';
  const totals = data.totals || {};
  const excluded = data.excluded || {};
  const rows = (title, items = []) => `<section class="adm-card"><h3>${esc(title)}</h3>${items.length
    ? `<table class="adm-mini-table"><thead><tr><th scope="col">${esc(title === 'Entry pages' ? 'Page' : 'Source / medium / campaign')}</th><th scope="col" class="num">Requests</th></tr></thead><tbody>${items.map((row) => `<tr><td>${esc(row.key)}<br><small class="muted">${esc(row.qualified)} qualified · ${esc(row.proposal)} proposal · ${esc(row.won)} won</small></td><td class="num">${esc(row.requests)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No customer website requests in this period.</p>'}</section>`;
  return `<section class="adm-card" aria-label="Website inquiry acquisition">
    <h2>Website inquiries · last ${esc(data.days)} days</h2>
    <p>${esc(totals.requests)} saved requests · ${esc(totals.phone)} call requests · ${esc(totals.email)} email requests${totals.unknown_contact ? ` · ${esc(totals.unknown_contact)} unspecified reply` : ''}</p>
    <p class="muted">Created ${esc(data.since?.slice(0, 10))}–${esc(data.until?.slice(0, 10))} (UTC). Figures use saved Quotes, not browser events. Stage counts show current state, not historical conversion rates or confirmed quote delivery. Unknown means no usable source was recorded.</p>
    <p class="muted">Excluded: ${esc(excluded.spam || 0)} spam · ${esc(excluded.staff || 0)} configured staff-email requests · ${esc(excluded.internal_test || 0)} marked internal/test. Mark phone-only tests in their Quotes drawer.</p>
    ${data.truncated ? `<p class="adm-status" data-state="err">Partial window: ${esc(data.scanned)} of ${esc(data.matched ?? 'unknown')} requests examined. Counts do not cover the full period.</p>` : ''}
    <div class="adm-report-grid">${rows('Acquisition sources', data.sources)}${rows('Entry pages', data.landing_pages)}</div>
  </section>`;
}

export function createTrafficRenderer({ $, api, admSkeleton, pct }) {
  function renderTrafficFunnel(funnel = []) {
    if (!funnel.length) return '<div class="adm-card"><h2>Funnel</h2><p class="muted">No funnel events yet.</p></div>';
    return `<div class="adm-card"><h2>Funnel</h2><table class="adm-mini-table"><tbody>${funnel.map((row) => `
      <tr><td>${esc(row.label || row.event)}</td><td class="num">${esc(row.count || 0)}</td><td class="num">${esc(pct(row.rate))}</td></tr>
    `).join('')}</tbody></table></div>`;
  }

  function renderTrafficCampaigns(topCampaigns = []) {
    if (!topCampaigns.length) return '<div class="adm-card"><h2>Acquisition</h2><p class="muted">No attribution recorded.</p></div>';
    return `<div class="adm-card"><h2>Acquisition</h2><table class="adm-mini-table"><tbody>${topCampaigns.map((row) => `
      <tr><td>${esc(row.key)}</td><td class="num">${esc(row.count)}</td></tr>
    `).join('')}</tbody></table></div>`;
  }

  function renderTrafficDays(byDay = []) {
    if (!byDay.length) return '<div class="adm-card"><h2>Daily trend</h2><p class="muted">No daily rows.</p></div>';
    return `<div class="adm-card"><h2>Daily trend</h2><table class="adm-mini-table"><thead><tr><th>Day</th><th>Views</th><th>Session IDs</th><th>Conversion events</th></tr></thead><tbody>${byDay.map((row) => `
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
      const [traffic, leads] = await Promise.allSettled([
        api('/api/admin/traffic?days=14'),
        api('/api/admin/lead-acquisition?days=28'),
      ]);
      const data = traffic.status === 'fulfilled' ? traffic.value : {};
      const leadReport = renderLeadAcquisition(leads.status === 'fulfilled' ? leads.value : null);
      if (!data.available) {
        box.innerHTML = `${leadReport}<p class="muted">${esc(data.note || 'Browser activity unavailable. Reload to retry.')}</p>`;
        return;
      }
      box.innerHTML = `<div class="adm-traffic-report">
        ${leadReport}
        <p class="muted">Browser activity only. Session IDs are not verified people; repeat events and internal visits may be included. Confirm leads in Quotes and payments in Orders.</p>
        ${data.truncated ? `<p class="adm-status" data-state="err">Partial window: showing ${esc(data.total)} events. Totals and rates do not cover the full period.</p>` : ''}
        <div class="adm-grid">
          <div class="adm-card adm-stat"><i class="ph ph-eye" aria-hidden="true"></i><b>${esc(data.total)}</b><span class="muted">Tracked events</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-users-three" aria-hidden="true"></i><b>${esc(data.unique)}</b><span class="muted">Session IDs with pageviews</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-arrow-square-out" aria-hidden="true"></i><b>${esc((data.events || []).find((row) => row.key === 'quote_submit')?.count || 0)}</b><span class="muted">Quote submits</span></div>
          <div class="adm-card adm-stat"><i class="ph ph-shopping-cart" aria-hidden="true"></i><b>${esc((data.events || []).find((row) => row.key === 'checkout_start')?.count || 0)}</b><span class="muted">Checkout starts</span></div>
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

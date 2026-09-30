import { esc } from '../util.js?v=20260929e';
import { salesSummary, salesTimeline, salesUrl } from './connected-sales-contract.js?v=20260929e';

const field = (label, key, options) => `<label class="crm-field">${label}<select class="adm-select" data-daily-filter="${key}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
export const dailyMarkup = {
  summary: '<h4>Workspace overview</h4><div data-daily-summary role="status">Loading totals…</div><button class="btn btn-ghost btn-sm" data-daily-summary-refresh>Refresh totals</button>',
  filters: `<div data-daily-filters>${field('Task status', 'status', [['open', 'Open'], ['', 'All statuses'], ['completed', 'Completed'], ['cancelled', 'Cancelled']])}
    ${field('Task assignment', 'assignment', [['', 'Everyone'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned']])}
    ${field('Task due', 'due', [['', 'Any due date'], ['overdue', 'Overdue open tasks'], ['unscheduled', 'No due date']])}
    ${field('Task priority', 'priority', [['', 'All priorities'], ['high', 'High'], ['normal', 'Normal']])}
    ${field('Task scope', 'scope', [['', 'Whole workspace'], ['prospect', 'Selected prospect']])}</div><p data-daily-task-status role="status"></p>`,
  timeline: '<section><h4>Prospect sales activity</h4><p>Task and deal changes directly linked to the selected prospect. Other activity stays in its existing history.</p><p data-daily-person></p><p data-daily-timeline-status role="status"></p><div data-daily-events></div><button class="btn btn-ghost btn-sm" data-daily-more hidden>More prospect activity</button><button class="btn btn-ghost btn-sm" data-daily-timeline-refresh>Refresh prospect activity</button></section>',
};

export function createDailyWork({ api, root, active, staffId, state, onTasksChange }) {
  const at = (key) => root.querySelector(`[data-daily-${key}]`);
  const prospect = () => root.querySelector('[data-sales-prospect]');
  const errorText = (error) => error?.data?.error?.message || error.message || 'CRM unavailable. Retry.';
  let summaryVersion = 0; let timelineVersion = 0; let cursor = null; let loadingMore = false; let shown = new Set();
  for (const select of at('filters').querySelectorAll('select')) select.value = state[select.dataset.dailyFilter] || '';
  function taskParams() {
    const params = {};
    for (const key of ['status', 'due', 'priority']) if (state[key]) params[key] = state[key];
    if (state.assignment === 'mine') params.owner_staff_id = staffId;
    if (state.assignment === 'unassigned') params.assignment = 'unassigned';
    if (state.scope === 'prospect') {
      if (!prospect().value) return null;
      params.person_id = prospect().value;
    }
    return params;
  }
  async function summary() {
    const version = ++summaryVersion;
    at('summary').textContent = 'Loading totals…';
    try {
      const value = salesSummary(await api(salesUrl('sales_summary')));
      if (!active() || version !== summaryVersion) return;
      at('summary').innerHTML = `<p>Open ${value.tasks.open} · Overdue ${value.tasks.overdue} · Completed ${value.tasks.completed}</p>
        ${value.deals.map((d) => `<p>${esc(d.currency)} · ${esc(d.status)} · ${d.count} deals · ${esc(d.amount ?? 'Amount unknown')}${d.unknown_amount_count ? ' · ' + d.unknown_amount_count + ' unknown amounts' : ''}</p>`).join('') || '<p>No deals yet.</p>'}`;
    } catch (error) { if (active() && version === summaryVersion) at('summary').textContent = 'Totals unavailable: ' + errorText(error); }
  }
  async function timeline(append = false) {
    if (append && (loadingMore || !cursor)) return;
    const version = ++timelineVersion; const person = prospect().value;
    if (!append) { cursor = null; shown = new Set(); at('events').replaceChildren(); }
    at('more').hidden = !cursor; at('more').disabled = true; loadingMore = true;
    at('person').textContent = person ? prospect().selectedOptions[0].textContent : '';
    at('timeline-status').textContent = person ? 'Loading activity…' : 'Choose a prospect to see sales activity.';
    if (!person) { loadingMore = false; return; }
    try {
      const page = salesTimeline(await api(salesUrl('sales_timeline', { person_id: person, limit: '10', ...(append ? { cursor } : {}) })), person);
      if (!active() || version !== timelineVersion || person !== prospect().value) return;
      for (const event of page.items) {
        if (shown.has(event.id)) continue;
        shown.add(event.id);
        at('events').insertAdjacentHTML('beforeend', `<article class="crm-contact"><p>${esc(event.reason)}</p><p>${esc(event.actor_role || 'Local operator')} · ${esc(new Date(event.created_at).toLocaleString())}</p><button class="btn btn-ghost btn-sm" data-sales-open="${event.entity_type}" data-id="${event.entity_id}">Open ${event.entity_type} ${esc(event.title)}</button></article>`);
      }
      cursor = page.next_cursor; at('more').hidden = !cursor;
      at('timeline-status').textContent = shown.size ? `${shown.size} changes shown.` : 'No directly linked sales activity yet.';
    } catch (error) {
      if (active() && version === timelineVersion) at('timeline-status').textContent = 'Activity unavailable: ' + errorText(error);
    } finally { if (active() && version === timelineVersion) { loadingMore = false; at('more').disabled = false; } }
  }
  at('filters').addEventListener('change', () => {
    for (const select of at('filters').querySelectorAll('select')) state[select.dataset.dailyFilter] = select.value;
    onTasksChange();
  });
  at('more').addEventListener('click', () => timeline(true));
  at('timeline-refresh').addEventListener('click', () => timeline());
  at('summary-refresh').addEventListener('click', () => summary());
  return { taskParams, summary, timeline, refresh: () => Promise.all([summary(), timeline()]),
    prospectChanged: () => { if (state.scope === 'prospect') onTasksChange(); return timeline(); } };
}

import { esc } from '../util.js?v=20260929e';
import { UUID, salesPage, salesUrl } from './connected-sales-contract.js?v=20260929e';
import { accountTimeline, engagementPage } from './connected-history-contract.js?v=20260929e';

export const historyMarkup = `<section class="crm-history"><h4>Account sales history</h4>
  <p>Task and deal changes linked to this CRM account when recorded. Customer accounts remain separate.</p>
  <label class="crm-field">CRM account<select class="adm-select" aria-label="CRM account" data-history-account><option value="">Choose an account</option></select></label>
  <p data-history-accounts-status role="status"></p><button class="btn btn-ghost btn-sm" data-history-accounts-refresh>Refresh accounts</button><button class="btn btn-ghost btn-sm" data-history-accounts-more hidden>More accounts</button>
  <p data-history-account-status role="status"></p><div data-history-account-events></div><button class="btn btn-ghost btn-sm" data-history-account-more hidden>More account history</button><button class="btn btn-ghost btn-sm" data-history-account-refresh>Refresh account history</button></section>
  <section class="crm-history"><h4>Prospect engagement history</h4><p>Recorded evidence for the selected prospect. Activity records alone do not verify delivery. Notes and reasons may be shortened.</p>
  <label class="crm-field">Engagement section<select class="adm-select" aria-label="Engagement section" data-history-section><option value="activities">Activities</option><option value="preferences">Preferences</option><option value="handoffs">Handoffs</option><option value="opportunities">Opportunities</option></select></label>
  <p data-history-person></p><p data-history-engagement-status role="status"></p><div data-history-engagement-events></div><button class="btn btn-ghost btn-sm" data-history-engagement-more hidden>More engagement history</button><button class="btn btn-ghost btn-sm" data-history-engagement-refresh>Refresh engagement history</button></section>`;

const when = (value) => esc(new Date(value).toLocaleString());
const errorText = (error) => error?.data?.error?.message || error.message || 'CRM unavailable. Retry.';
function engagementCard(row) {
  let detail;
  if (row.section === 'activities') detail = `<strong>${esc(row.kind)}</strong><p>Source: ${esc(row.source)}</p><p>Occurred ${when(row.occurred_at)}</p>${row.note ? `<p>${esc(row.note)}</p>` : ''}<p>${esc(row.reason)}</p>`;
  else if (row.section === 'preferences') detail = `<strong>${esc(row.channel)} · ${esc(row.status)}</strong><p>${esc(row.reason)}</p>`;
  else if (row.section === 'handoffs') detail = `<strong>Handoff · ${esc(row.status)} · v${row.version}</strong><p>${esc(row.reason)}</p><p>Reference ${esc(row.handoff_id)}</p>`;
  else detail = `<strong>Opportunity recorded</strong><p>Handoff ${esc(row.handoff_id)}</p>`;
  return `<article class="crm-contact crm-history-event">${detail}<p>Recorded ${when(row.created_at)}</p></article>`;
}

export function createConnectedHistory({ api, root, active }) {
  const at = (key) => root.querySelector(`[data-history-${key}]`);
  const prospect = () => root.querySelector('[data-sales-prospect]');
  let accountsCursor = null; let accountsBusy = false;
  const states = { account: { version: 0 }, engagement: { version: 0 } };
  async function accounts(append = false) {
    if (accountsBusy || (append && !accountsCursor)) return;
    accountsBusy = true; at('accounts-more').disabled = true; at('accounts-refresh').disabled = true;
    at('accounts-status').textContent = 'Loading accounts…';
    try {
      const page = salesPage(await api(salesUrl('sales_accounts', { limit: '25', ...(append ? { cursor: accountsCursor } : {}) })), (row) => {
        if (!UUID.test(row.id) || typeof row.name !== 'string' || row.name.length > 400 || !(row.merged_into === null || UUID.test(row.merged_into))) throw new Error('Invalid account list. Retry.');
      });
      if (!active()) return;
      const previous = at('account').value;
      if (!append) at('account').replaceChildren(new Option('Choose an account', ''));
      const ids = new Set([...at('account').options].map((option) => option.value));
      for (const row of page.items) if (!ids.has(row.id)) at('account').add(new Option(`${row.name || 'Unnamed account'}${row.merged_into ? ' (merged)' : ''} · ${row.id.slice(-8)}`, row.id));
      at('account').value = previous;
      accountsCursor = page.next_cursor; at('accounts-more').hidden = !accountsCursor;
      at('accounts-status').textContent = `${at('account').options.length - 1} accounts shown.`;
      if (!append) await history('account');
    } catch (error) { if (active()) at('accounts-status').textContent = 'Accounts unavailable: ' + errorText(error); }
    finally { accountsBusy = false; if (active()) { at('accounts-more').disabled = false; at('accounts-refresh').disabled = false; } }
  }
  async function history(kind, append = false) {
    const state = states[kind];
    if (append && (state.busy || !state.cursor)) return;
    const version = ++state.version; const subject = kind === 'account' ? at('account').value : prospect().value; const section = at('section').value;
    state.busy = true;
    if (!append) { state.cursor = null; state.shown = new Set(); at(`${kind}-events`).replaceChildren(); }
    at(`${kind}-more`).hidden = !state.cursor; at(`${kind}-more`).disabled = true;
    if (kind === 'engagement') at('person').textContent = subject ? prospect().selectedOptions[0].textContent : '';
    at(`${kind}-status`).textContent = subject ? 'Loading history…' : `Choose ${kind === 'account' ? 'an account' : 'a prospect'} to see history.`;
    if (!subject) { state.busy = false; return; }
    try {
      const resource = kind === 'account' ? 'sales_account_timeline' : 'sales_engagement';
      const params = kind === 'account' ? { organization_id: subject } : { person_id: subject, section };
      const value = await api(salesUrl(resource, { ...params, limit: '10', ...(append ? { cursor: state.cursor } : {}) }));
      const page = kind === 'account' ? accountTimeline(value, subject) : engagementPage(value, subject, section);
      if (!active() || version !== state.version) return;
      for (const row of page.items) {
        if (state.shown.has(row.id)) continue;
        state.shown.add(row.id);
        const markup = kind === 'engagement' ? engagementCard(row) : `<article class="crm-contact"><p>${esc(row.reason)}</p><p>${esc(row.actor_role || 'Local operator')} · Recorded ${when(row.created_at)}</p><button class="btn btn-ghost btn-sm" data-sales-open="${row.entity_type}" data-id="${row.entity_id}">Open ${row.entity_type} ${esc(row.title)}</button></article>`;
        at(`${kind}-events`).insertAdjacentHTML('beforeend', markup);
      }
      state.cursor = page.next_cursor; at(`${kind}-more`).hidden = !state.cursor;
      at(`${kind}-status`).textContent = state.shown.size ? `${state.shown.size} records shown.` : `No recorded ${kind === 'account' ? 'account sales changes' : section} for this selection.`;
    } catch (error) { if (active() && version === state.version) at(`${kind}-status`).textContent = 'History unavailable: ' + errorText(error); }
    finally { if (active() && version === state.version) { state.busy = false; at(`${kind}-more`).disabled = false; } }
  }
  for (const kind of ['account', 'engagement']) {
    at(`${kind}-more`).addEventListener('click', () => history(kind, true));
    at(`${kind}-refresh`).addEventListener('click', () => history(kind));
  }
  at('account').addEventListener('change', () => history('account'));
  at('section').addEventListener('change', () => history('engagement'));
  at('accounts-more').addEventListener('click', () => accounts(true));
  at('accounts-refresh').addEventListener('click', () => accounts());
  return { accounts, prospectChanged: () => history('engagement'), refresh: () => Promise.all([history('account'), history('engagement')]) };
}

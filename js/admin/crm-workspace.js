// Admin CRM workspace tab — a home for cross-account CRM surfaces. Hosts
// sub-views (Tasks inbox, Contact directory) under one tab. Shell only in this
// slice; sub-views are filled by later plans. Mirrors the createQuotesTab shape
// (#36 per-tab split). Shared primitives ($, api, state, admSkeleton, admEmpty)
// are injected; esc/delegate come from util.js.
import { esc, delegate } from '../util.js';

export function createCrmWorkspace({ $, api, state, admSkeleton, admEmpty }) {
  const SUBTABS = [['tasks', 'Tasks'], ['contacts', 'Contacts']];

  function shell() {
    const view = state.crmView || 'tasks';
    return `<div class="crm-ws">
      <div class="crm-tabs" role="group" aria-label="CRM sections">
        ${SUBTABS.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === view ? ' is-active' : ''}" type="button" data-crm-ws-tab="${v}" aria-pressed="${v === view}">${l}</button>`).join('')}
      </div>
      <div class="crm-ws-body" data-crm-ws-body aria-live="polite"></div>
    </div>`;
  }

  // Placeholder sub-views — replaced by plans 002 (tasks) and 003 (contacts).
  async function renderTasks(body) {
    body.innerHTML = admEmpty('ph-check-square', 'Task inbox', 'Cross-account follow-up tasks will appear here.');
  }
  async function renderContacts(body) {
    body.innerHTML = admEmpty('ph-address-book', 'Contact directory', 'Search contacts across every account here.');
  }

  function showView(view) {
    state.crmView = view;
    const box = $('admCrm');
    box.querySelectorAll('[data-crm-ws-tab]').forEach((b) => {
      const on = b.dataset.crmWsTab === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const body = box.querySelector('[data-crm-ws-body]');
    if (view === 'contacts') renderContacts(body);
    else renderTasks(body);
  }

  function renderCrm() {
    const box = $('admCrm');
    if (!box) return;
    box.innerHTML = shell();
    state.loaded.add('crm');
    showView(state.crmView || 'tasks');
  }

  function wireCrm() {
    const box = $('admCrm');
    if (!box) return;
    delegate(box, 'click', '[data-crm-ws-tab]', (event, btn) => showView(btn.dataset.crmWsTab));
  }

  return { renderCrm, wireCrm };
}

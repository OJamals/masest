// Admin customers tab (#36 per-tab split). Read-only roster of approved customers
// with in-memory search. Shared primitives ($, api, state, admSkeleton, admEmpty)
// and the statusBadge helper are injected; esc comes from util.js.
import { esc } from '../util.js';

export function createCustomersTab({ $, api, state, admSkeleton, admEmpty, statusBadge }) {
  async function renderCustomers({ refetch = true } = {}) {
    const box = $('admCustomers');
    if (refetch) {
      box.innerHTML = admSkeleton();
      try {
        state.customers = (await api('/api/admin/customers')).customers || [];
        state.loaded.add('customers');
      } catch {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load customers. Reload to retry.</p>';
        return;
      }
    }
    const q = $('custSearch').value.trim().toLowerCase();
    state.customers = state.customers || [];
    const rows = state.customers.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
    if (!rows.length) { box.innerHTML = admEmpty('ph-users', 'No customers', 'Approved customers and their companies appear here.'); return; }
    box.innerHTML = `<table class="adm"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Tier</th><th>Role</th></tr></thead><tbody>${rows.map((c) => `
      <tr>
        <td>${esc(c.full_name || '-')}${c.phone ? `<br><span class="muted">${esc(c.phone)}</span>` : ''}</td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">-</span>'}</td>
        <td>${esc(c.company_name || '-')}</td>
        <td>${statusBadge(c.company_status || '-')}</td>
        <td>${esc(c.price_tier || 'retail')}</td>
        <td>${esc(c.role || '')}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  return { renderCustomers };
}

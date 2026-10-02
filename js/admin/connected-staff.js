import { directoryPage } from './connected-history-contract.js?v=20260929e';
import { salesUrl } from './connected-sales-contract.js?v=20260929e';

export function createStaffDirectory({ api, root, active, context, dailyState }) {
  let version = 0; let cursor = null; let busy = false;
  context.staff_members = new Map();
  const at = (key) => root.querySelector(`[data-staff-${key}]`);
  function populate() {
    for (const select of root.querySelectorAll('select[name="assignment"], [data-daily-filter="assignment"]')) {
      const value = select.matches('[data-daily-filter="assignment"]') ? dailyState.assignment || '' : select.value;
      select.querySelectorAll('[data-staff-option]').forEach((option) => option.remove());
      for (const member of context.staff_members.values()) {
        if (member.staff_id === context.staff_id) continue;
        const option = new Option(`${member.display_name} · ${member.role} · ${member.staff_id.slice(-8)}`, member.staff_id);
        option.dataset.staffOption = 'true'; select.add(option);
      }
      if ([...select.options].some((option) => option.value === value)) select.value = value;
      else if (value) { const option = new Option('Previously selected staff — refresh or choose another', value); option.dataset.staffOption = 'true'; option.disabled = true; select.add(option); select.value = value; }
    }
  }
  async function load(append = false) {
    if (busy || (append && !cursor)) return;
    const current = ++version; busy = true;
    at('status').textContent = 'Loading staff…'; at('more').disabled = true; at('refresh').disabled = true;
    try {
      const page = directoryPage(await api(salesUrl('staff_directory', { limit: '25', ...(append ? { cursor } : {}) })));
      if (!active() || version !== current) return;
      if (!append) context.staff_members = new Map();
      for (const member of page.items) context.staff_members.set(member.staff_id, member);
      cursor = page.next_cursor; populate(); at('more').hidden = !cursor;
      at('status').textContent = `${context.staff_members.size} profile-managed staff shown. Environment-only operators can assign to themselves.`;
    } catch (error) { if (active() && version === current) at('status').textContent = 'Staff directory unavailable. Refresh to retry. ' + (error?.data?.error?.message || error.message); }
    finally { busy = false; if (active()) { at('more').disabled = false; at('refresh').disabled = false; } }
  }
  at('more').addEventListener('click', () => load(true)); at('refresh').addEventListener('click', () => load());
  return { load, populate };
}

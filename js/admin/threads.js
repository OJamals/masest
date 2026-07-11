import { esc, dateTime as date, delegate } from '../util.js?v=20260711i';

export function createThreadsTab({ $, api, state, message, admSkeleton, admEmpty, sourceLabel, refreshStats }) {
  const prefs = ['notify_admin_support_requests', 'notify_admin_messages'];

  function setDrawer(open) {
    const drawer = $('adminSupportDrawer');
    const launcher = $('adminSupportLauncher');
    if (!drawer || !launcher) return;
    drawer.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) drawer.querySelector('[data-company-thread]')?.focus();
  }

  async function savePrefs() {
    const body = Object.fromEntries(prefs.map((key) => [key, Boolean($(key === 'notify_admin_support_requests' ? 'adminNotifySupportRequests' : 'adminNotifyMessages')?.checked)]));
    try {
      await api('/api/admin/message-settings', { method: 'PATCH', body });
      message('adminSupportSettingsStatus', 'Saved.', 'ok');
    } catch { message('adminSupportSettingsStatus', 'Could not save settings.', 'err'); }
  }

  async function loadPrefs() {
    try {
      const data = await api('/api/admin/message-settings');
      $('adminNotifySupportRequests').checked = data.notify_admin_support_requests === true;
      $('adminNotifyMessages').checked = data.notify_admin_messages === true;
    } catch { message('adminSupportSettingsStatus', 'Could not load settings.', 'err'); }
  }

  async function setThreadStatus(companyId, status) {
    await api('/api/admin/messages', { method: 'PATCH', body: { company_id: companyId, status } });
    await openThread(companyId);
    await renderThreads();
  }

  async function openThread(companyId) {
    const view = $('admThreadView');
    view.textContent = 'Loading...';
    setDrawer(true);
    try {
      const result = await api(`/api/admin/messages?company_id=${encodeURIComponent(companyId)}`);
      const messages = result.messages || [];
      const thread = result.thread || { company_id: companyId, company_name: 'Customer', status: 'open' };
      state.selectedThread = companyId;
      const complete = thread.status === 'complete';
      view.innerHTML = `<header class="support-thread-head"><div><p class="adm-eyebrow">${complete ? 'Completed' : 'Open conversation'}</p><h3>${esc(thread.company_name)}</h3></div><div class="adm-inline-actions"><span class="badge" data-s="${complete ? 'complete' : 'new'}">${complete ? 'Complete' : 'Open'}</span><button class="btn btn-ghost btn-sm" type="button" data-thread-status="${complete ? 'open' : 'complete'}">${complete ? 'Reopen thread' : 'Mark complete'}</button><button class="btn btn-ghost btn-sm" type="button" data-thread-escalate>Escalate</button></div></header><div class="msg-thread">${messages.map((m) => `<div class="msg" data-role="${esc(m.sender_role)}"><p>${esc(m.body)}</p><span class="muted">${sourceLabel(m)} ${esc(date(m.created_at))}</span></div>`).join('')}</div><form id="replyForm" class="adm-form-grid support-reply-form" data-capability-scope="admin.write"><label class="full">Reply <textarea id="replyBody" class="adm-textarea" required></textarea></label><button class="btn btn-primary" type="submit">Send reply</button><p id="replyStatus" class="adm-status"></p></form>`;
      view.querySelector('[data-thread-status]').addEventListener('click', (event) => setThreadStatus(companyId, event.currentTarget.dataset.threadStatus));
      view.querySelector('[data-thread-escalate]').addEventListener('click', () => { message('replyStatus', 'Escalation noted. Keep this thread open and assign follow-up in CRM.', 'warn'); });
      $('replyForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const send = event.target.querySelector('[type="submit"]');
        if (send.disabled) return;
        send.disabled = true; message('replyStatus', 'Sending...');
        try { await api('/api/admin/messages', { method: 'POST', body: { company_id: companyId, body: $('replyBody').value } }); await openThread(companyId); await renderThreads(); }
        catch (err) { send.disabled = false; message('replyStatus', err.data?.error || 'Could not send reply.', 'err'); }
      });
      refreshStats?.();
    } catch { view.innerHTML = '<p class="adm-status" data-state="err">Could not load this thread.</p>'; }
  }

  async function renderThreads({ refetch = true } = {}) {
    const box = $('admThreads');
    if (refetch) {
      box.innerHTML = admSkeleton();
      try { state.threads = (await api('/api/admin/messages')).threads || []; state.loaded.add('support-settings'); }
      catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load support.</p>'; return; }
    }
    const threads = [...(state.threads || [])].sort((a, b) => Number(b.unanswered) - Number(a.unanswered) || String(b.last_at).localeCompare(String(a.last_at)));
    const unanswered = threads.filter((thread) => thread.unanswered).length;
    const counter = $('adminSupportUnread');
    if (counter) { counter.hidden = !unanswered; counter.textContent = unanswered; }
    const summary = $('adminSupportSummary'); if (summary) summary.textContent = unanswered ? `${unanswered} unresolved chat${unanswered === 1 ? '' : 's'}` : 'No unresolved chats';
    if (!threads.length) { box.innerHTML = admEmpty('ph-lifebuoy', 'No conversations', 'New customer requests appear here.'); return; }
    box.innerHTML = threads.map((thread) => `<button type="button" class="support-thread-item ${thread.unanswered ? 'is-unanswered' : ''}" data-company-thread="${esc(thread.company_id)}" aria-pressed="${thread.company_id === state.selectedThread}"><span><b>${esc(thread.company_name || thread.company_id)}</b><small>${esc((thread.last_body || '').slice(0, 90))}</small></span><span class="support-thread-meta"><span class="badge" data-s="${thread.status === 'complete' ? 'complete' : 'new'}">${thread.status === 'complete' ? 'Complete' : 'Open'}</span>${thread.unanswered ? '<span class="support-unanswered">Needs reply</span>' : ''}</span></button>`).join('');
  }

  function wireThreads() {
    const box = $('admThreads');
    delegate(box, 'click', '[data-company-thread]', (_event, button) => openThread(button.dataset.companyThread));
    $('adminSupportLauncher')?.addEventListener('click', () => setDrawer($('adminSupportDrawer').hidden));
    $('adminSupportClose')?.addEventListener('click', () => setDrawer(false));
    $('adminSupportSettings')?.addEventListener('click', () => document.querySelector('[data-tab="support-settings"]')?.click());
    for (const id of ['adminNotifySupportRequests', 'adminNotifyMessages']) $(id)?.addEventListener('change', savePrefs);
    void loadPrefs();
  }

  return { renderThreads, wireThreads, openThread };
}

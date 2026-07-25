import { esc, dateTime as date, delegate } from '../util.js?v=20260725b';

const POLL_MS = 15_000;
const PRESENCE_HEARTBEAT_MS = 30_000;

export function createThreadsTab({ $, api, state, message, admSkeleton, admEmpty, sourceLabel, refreshStats }) {
  const prefs = ['notify_admin_support_requests', 'notify_admin_messages'];
  let pollId = 0;
  let presencePing = 0;
  let inboxOpen = false;
  let presenceRequest = Promise.resolve();
  let threadMessages = [];
  let threadPage = { has_more: false, next_before: null };
  let currentThread = null;

  async function setInboxPresence(open, { force = false, keepalive = false } = {}) {
    if (!force && inboxOpen === open) return;
    inboxOpen = open;
    presenceRequest = presenceRequest.catch(() => {}).then(() => api('/api/admin/message-settings', {
        method: 'POST',
        body: { action: 'inbox_presence', inbox_open: open },
        keepalive,
      })).then(() => {
      if (open) presencePing = Date.now();
    });
    try { await presenceRequest; }
    catch { if (inboxOpen === open) inboxOpen = !open; }
  }

  function setDrawer(open) {
    const drawer = $('adminSupportDrawer');
    const launcher = $('adminSupportLauncher');
    if (!drawer || !launcher) return;
    drawer.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      void setInboxPresence(true);
      requestAnimationFrame(() => (drawer.querySelector('[data-company-thread]') || $('adminSupportClose'))?.focus());
    } else {
      void setInboxPresence(false);
      launcher.focus();
    }
  }

  function syncSelectedThread() {
    document.querySelectorAll('[data-company-thread]').forEach((button) => {
      const selected = button.dataset.companyThread === state.selectedThread;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
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

  function threadStatusMeta(status) {
    if (status === 'complete') return { eyebrow: 'Resolved conversation', label: 'Resolved', badge: 'complete' };
    if (status === 'escalated') return { eyebrow: 'Escalated conversation', label: 'Escalated', badge: 'pending' };
    return { eyebrow: 'Open conversation', label: 'Open', badge: 'new' };
  }

  function renderThreadView() {
    const view = $('admThreadView');
    const thread = currentThread;
    const status = thread?.status || 'open';
    const meta = threadStatusMeta(status);
    const resolved = status === 'complete';
    const secondaryStatus = status === 'escalated' ? 'open' : 'escalated';
    const secondaryLabel = status === 'escalated' ? 'Return to open' : 'Escalate';
    view.innerHTML = `<header class="support-thread-head"><div><p class="adm-eyebrow">${meta.eyebrow}</p><h3>${esc(thread?.company_name || 'Customer')}</h3></div><div class="adm-inline-actions"><span class="badge" data-s="${meta.badge}">${meta.label}</span>${resolved ? '<button class="btn btn-ghost btn-sm" type="button" data-thread-status="open" data-capability="admin.write">Reopen thread</button>' : `<button class="btn btn-ghost btn-sm" type="button" data-thread-status="complete" data-capability="admin.write">Mark resolved</button><button class="btn btn-ghost btn-sm" type="button" data-thread-status="${secondaryStatus}" data-capability="admin.write">${secondaryLabel}</button>`}</div></header>${threadPage.has_more ? '<button class="btn btn-ghost btn-sm support-load-earlier" type="button" data-thread-load-older>Load earlier messages</button>' : ''}<div class="msg-thread">${threadMessages.map((m) => `<div class="msg" data-role="${esc(m.sender_role)}"><p>${esc(m.body)}</p><span class="muted">${sourceLabel(m)} ${esc(date(m.created_at))}</span></div>`).join('')}</div>${resolved ? '<p class="adm-status">Reopen this conversation before replying.</p>' : '<form id="replyForm" class="adm-form-grid support-reply-form" data-capability-scope="admin.write"><label class="full">Reply <textarea id="replyBody" name="reply_message" autocomplete="off" class="adm-textarea" maxlength="4000" required></textarea></label><button class="btn btn-primary" type="submit">Send reply</button><p id="replyStatus" class="adm-status" role="status" aria-live="polite"></p></form>'}`;
    view.querySelectorAll('[data-thread-status]').forEach((button) => button.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { await setThreadStatus(thread.company_id, event.currentTarget.dataset.threadStatus); }
      catch (error) { event.currentTarget.disabled = false; message('replyStatus', error.data?.error || 'Could not update thread.', 'err'); }
    }));
    view.querySelector('[data-thread-load-older]')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      void openThread(thread.company_id, { before: threadPage.next_before, older: true });
    });
    $('replyForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const send = event.target.querySelector('[type="submit"]');
      if (send.disabled) return;
      send.disabled = true; message('replyStatus', 'Sending…');
      try {
        await api('/api/admin/messages', { method: 'POST', body: { company_id: thread.company_id, body: $('replyBody').value } });
        await openThread(thread.company_id);
        await renderThreads();
      } catch (error) {
        send.disabled = false;
        message('replyStatus', error.data?.error || 'Could not send reply.', 'err');
      }
    });
  }

  async function openThread(companyId, { before = null, older = false } = {}) {
    const view = $('admThreadView');
    if (!older) view.textContent = 'Loading…';
    setDrawer(true);
    try {
      const suffix = before ? `&before=${encodeURIComponent(before)}` : '';
      const result = await api(`/api/admin/messages?company_id=${encodeURIComponent(companyId)}${suffix}`);
      currentThread = result.thread || currentThread || { company_id: companyId, company_name: 'Customer', status: 'open' };
      threadMessages = older ? [...(result.messages || []), ...threadMessages] : (result.messages || []);
      threadPage = { has_more: result.has_more === true, next_before: result.next_before || null };
      state.selectedThread = companyId;
      renderThreadView();
      syncSelectedThread();
      if (older) view.querySelector('.msg-thread')?.scrollTo({ top: 0, behavior: 'instant' });
      refreshStats?.();
    } catch { view.innerHTML = '<p class="adm-status" data-state="err">Could not load this thread.</p>'; }
  }

  async function renderThreads({ refetch = true } = {}) {
    const box = $('admThreads');
    if (refetch) {
      if (!state.threads?.length) box.innerHTML = admSkeleton();
      try { state.threads = (await api('/api/admin/messages')).threads || []; state.loaded.add('support-settings'); }
      catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load support.</p>'; return; }
    }
    const threads = [...(state.threads || [])].sort((a, b) => Number(b.unanswered) - Number(a.unanswered) || String(b.last_at).localeCompare(String(a.last_at)));
    const unanswered = threads.filter((thread) => thread.unanswered).length;
    const counter = $('adminSupportUnread');
    if (counter) { counter.hidden = !unanswered; counter.textContent = unanswered; }
    const summary = $('adminSupportSummary');
    if (summary) summary.textContent = unanswered
      ? unanswered === 1 ? '1 chat needs a reply' : `${unanswered} chats need a reply`
      : 'No chats need a reply';
    if (!threads.length) { box.innerHTML = admEmpty('ph-lifebuoy', 'No conversations', 'No open customer conversations right now.'); return; }
    box.innerHTML = threads.map((thread) => `<button type="button" class="support-thread-item ${thread.unanswered ? 'is-unanswered' : ''} ${thread.company_id === state.selectedThread ? 'is-selected' : ''}" data-company-thread="${esc(thread.company_id)}" aria-pressed="${thread.company_id === state.selectedThread}"><span><b>${esc(thread.company_name || thread.company_id)}</b><small>${esc((thread.last_body || '').slice(0, 90))}</small></span><span class="support-thread-meta"><span class="badge" data-s="${thread.status === 'escalated' ? 'pending' : 'new'}">${thread.status === 'escalated' ? 'Escalated' : 'Open'}</span>${thread.unanswered ? '<span class="support-unanswered">Needs reply</span>' : ''}</span></button>`).join('');
  }

  function startPolling() {
    if (pollId) return;
    pollId = window.setInterval(() => {
      if (document.hidden) return;
      void renderThreads();
      if (!$('adminSupportDrawer')?.hidden && Date.now() - presencePing > PRESENCE_HEARTBEAT_MS) {
        void setInboxPresence(true, { force: true });
      }
    }, POLL_MS);
  }

  function wireThreads() {
    const box = $('admThreads');
    delegate(box, 'click', '[data-company-thread]', (_event, button) => openThread(button.dataset.companyThread));
    $('adminSupportLauncher')?.addEventListener('click', () => setDrawer($('adminSupportDrawer').hidden));
    $('adminSupportClose')?.addEventListener('click', () => setDrawer(false));
    $('adminSupportSettings')?.addEventListener('click', () => {
      setDrawer(false);
      document.querySelector('[data-tab="support-settings"]')?.click();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('adminSupportDrawer')?.hidden) setDrawer(false);
    });
    document.addEventListener('visibilitychange', () => {
      if ($('adminSupportDrawer')?.hidden) return;
      void setInboxPresence(!document.hidden, { force: true, keepalive: document.hidden });
      if (!document.hidden) void renderThreads();
    });
    window.addEventListener('pagehide', () => {
      if (!$('adminSupportDrawer')?.hidden) void setInboxPresence(false, { force: true, keepalive: true });
    });
    for (const id of ['adminNotifySupportRequests', 'adminNotifyMessages']) $(id)?.addEventListener('change', savePrefs);
    void loadPrefs();
    startPolling();
  }

  return { renderThreads, wireThreads, openThread };
}

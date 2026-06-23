// Admin messages/threads tab (#36 per-tab split). Lists buyer conversations and
// opens a thread with an inline reply form. Shared primitives + the admin-local
// sourceLabel/message helpers are injected; esc/date come from the shared util.
import { esc, dateTime as date, delegate } from '../util.js';

export function createThreadsTab({ $, api, state, message, admSkeleton, sourceLabel }) {
  async function openThread(companyId) {
    const view = $('admThreadView');
    view.textContent = 'Loading...';
    try {
      const messages = (await api(`/api/admin/messages?company_id=${encodeURIComponent(companyId)}`)).messages || [];
      view.innerHTML = `<div class="msg-thread">${messages.map((m) => `
      <div class="msg" data-role="${esc(m.sender_role)}"><p>${esc(m.body)}</p><span class="muted">${sourceLabel(m)} ${esc(date(m.created_at))}</span></div>
    `).join('')}</div>
    <form id="replyForm" class="adm-form-grid" style="margin-top:12px">
      <label class="full">Reply <textarea id="replyBody" class="adm-textarea" required></textarea></label>
      <button class="btn btn-primary" type="submit">Send reply</button>
      <p id="replyStatus" class="adm-status"></p>
    </form>`;
      $('replyForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        message('replyStatus', 'Sending...');
        try {
          await api('/api/admin/messages', { method: 'POST', body: { company_id: companyId, body: $('replyBody').value } });
          await openThread(companyId);
          await renderThreads();
        } catch (err) {
          message('replyStatus', err.data?.error || 'Could not send the reply. Retry.', 'err');
        }
      });
    } catch {
      view.innerHTML = '<p class="adm-status" data-state="err">Could not load this thread. Reload to retry.</p>';
    }
  }

  async function renderThreads({ refetch = true } = {}) {
    const box = $('admThreads');
    if (refetch) {
      box.innerHTML = admSkeleton();
      try {
        state.threads = (await api('/api/admin/messages')).threads || [];
        state.loaded.add('messages');
      } catch {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load messages. Reload to retry.</p>';
        return;
      }
    }
    state.threads = state.threads || [];
    if (!state.threads.length) {
      box.innerHTML = '<p class="muted">No conversations.</p>';
      return;
    }
    box.innerHTML = state.threads.map((thread) => `
    <button type="button" data-company-thread="${esc(thread.company_id)}">
      <b>${esc(thread.company_name || thread.company_id)}</b>
      ${thread.unread ? `<span class="pill">${esc(thread.unread)}</span>` : ''}
      <br><span class="muted">${esc((thread.last_body || '').slice(0, 80))}</span>
    </button>
  `).join('');
  }

  // Thread-open clicks delegated once on the stable #admThreads list container (#36).
  function wireThreads() {
    const box = $('admThreads');
    if (!box) return;
    delegate(box, 'click', '[data-company-thread]', (event, button) => openThread(button.dataset.companyThread));
  }

  return { renderThreads, wireThreads };
}

/* Admin support: settings prefs + a handle on the shared customer-support console.
 *
 * The inbox itself lives in js/admin-support.js and is the SAME console public
 * pages mount. admin.html used to ship a second, near-identical drawer with its
 * own launcher, so staff saw one support UI on /admin and a different-looking
 * one everywhere else — both driving the same threads. This module no longer
 * renders an inbox; it mounts that console and keeps the notification prefs that
 * belong to the Customer support tab.
 */

export function createThreadsTab({ $, api, state, message }) {
  const prefs = ['notify_admin_support_requests', 'notify_admin_messages'];
  let consolePromise = null;

  // One console per document, lazily mounted. initAdminSupport() returns null if
  // one is already present, so a second call cannot produce a second inbox.
  function ensureConsole() {
    consolePromise ||= import('../admin-support.js?v=20260807a')
      .then(({ initAdminSupport }) => initAdminSupport({
        auth: { api },
        root: '/',
        staff: state.staff,
      }))
      .catch(() => null);
    return consolePromise;
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

  // The console polls its own thread list, so a tab render only has to make sure
  // it exists and pull a fresh count.
  async function renderThreads() {
    const support = await ensureConsole();
    await support?.refresh?.();
  }

  // Accounts tab deep link ("message this business") opens the shared console on
  // that company rather than a second inbox implementation.
  async function openThread(companyId) {
    const support = await ensureConsole();
    await support?.openThread?.(companyId);
  }

  function wireThreads() {
    for (const id of ['adminNotifySupportRequests', 'adminNotifyMessages']) {
      $(id)?.addEventListener('change', savePrefs);
    }
    void loadPrefs();
    void ensureConsole();
  }

  return { renderThreads, wireThreads, openThread };
}

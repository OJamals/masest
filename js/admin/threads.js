/* Admin support: a handle on the shared customer-support console.
 *
 * The inbox itself lives in js/admin-support.js and is the SAME console public
 * pages mount. admin.html used to ship a second, near-identical drawer with its
 * own launcher, so staff saw one support UI on /admin and a different-looking
 * one everywhere else — both driving the same threads. This module renders
 * nothing of its own; it mounts that console and exposes its entry points to
 * the rest of admin.js.
 *
 * The notification prefs used to live here too, on a #support-settings page.
 * They are a view of the console now — a phone-width drawer covered the page it
 * had just navigated to — so this module no longer loads or saves them.
 */

export function createThreadsTab({ api, state }) {
  let consolePromise = null;

  // One console per document, lazily mounted. initAdminSupport() returns null if
  // one is already present, so a second call cannot produce a second inbox.
  function ensureConsole() {
    consolePromise ||= import('../admin-support.js?v=20260807i')
      .then(({ initAdminSupport }) => initAdminSupport({
        auth: { api },
        root: '/',
        staff: state.staff,
      }))
      .catch(() => null);
    return consolePromise;
  }

  // The console polls its own thread list, so a render only has to make sure it
  // exists and pull a fresh count.
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

  async function openConsole() {
    const support = await ensureConsole();
    await support?.open?.();
  }

  async function openSettings() {
    const support = await ensureConsole();
    await support?.openSettings?.();
  }

  function wireThreads() {
    void ensureConsole();
  }

  return { renderThreads, wireThreads, openThread, openConsole, openSettings };
}

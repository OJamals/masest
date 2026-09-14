/* Staff-session lifecycle. Keeps auth completion, dirty-edit handling, UI reset,
 * and the hard document reset in one order so cached admin data and pollers never
 * survive into a later staff session.
 *
 * Every open admin tab shares one Supabase session, so when it ends in one tab the
 * others still hold cached records and live write controls until their next API
 * call 401s. `announce` tells sibling tabs the session ended; `subscribe` receives
 * that notice. A peer notice never re-announces, so tabs cannot storm each other. */
export function createAdminSessionLifecycle({
  logout,
  hasUnsavedEdits = () => false,
  confirmDiscard = async () => true,
  clearUnsavedEdits = () => {},
  showGate = () => {},
  reload = () => {},
  hasStaff = () => false,
  announce = () => {},
  subscribe = () => {},
} = {}) {
  let ending = false;

  async function signOut() {
    if (ending) return false;
    if (hasUnsavedEdits() && !await confirmDiscard()) return false;

    ending = true;
    try {
      await logout();
      announce('signed-out');
      clearUnsavedEdits();
      showGate({ expired: false });
      reload();
      return true;
    } catch (error) {
      ending = false;
      throw error;
    }
  }

  function expire({ hadStaff = false } = {}) {
    showGate({ expired: true });
    if (!hadStaff || ending) return false;

    ending = true;
    announce('expired');
    clearUnsavedEdits();
    reload();
    return true;
  }

  // A sibling tab ended the shared session. Only a tab that actually holds staff
  // state has anything to reset; an anonymous tab already sits on the gate.
  function peerEnded(reason = 'expired') {
    if (ending || !hasStaff()) return false;
    ending = true;
    showGate({ expired: reason !== 'signed-out' });
    clearUnsavedEdits();
    reload();
    return true;
  }

  subscribe(peerEnded);

  return Object.freeze({ signOut, expire, peerEnded });
}

// localStorage-backed peer channel. `storage` fires only in OTHER same-origin
// tabs, so the announcing tab never hears itself; the timestamp keeps repeat
// announcements distinct (an unchanged value fires no event).
export function createSessionPeerChannel({ key, storage, target } = {}) {
  return {
    announce(reason) {
      try { storage?.setItem(key, JSON.stringify({ reason, at: Date.now() })); } catch { /* private mode / quota */ }
    },
    subscribe(handler) {
      target?.addEventListener?.('storage', (event) => {
        if (event.key !== key || !event.newValue) return;
        let reason = 'expired';
        try { reason = JSON.parse(event.newValue)?.reason || 'expired'; } catch { /* malformed peer payload */ }
        handler(reason);
      });
    },
  };
}

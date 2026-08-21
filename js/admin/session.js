/* Staff-session lifecycle. Keeps auth completion, dirty-edit handling, UI reset,
 * and the hard document reset in one order so cached admin data and pollers never
 * survive into a later staff session. */
export function createAdminSessionLifecycle({
  logout,
  hasUnsavedEdits = () => false,
  confirmDiscard = async () => true,
  clearUnsavedEdits = () => {},
  showGate = () => {},
  reload = () => {},
} = {}) {
  let ending = false;

  async function signOut() {
    if (ending) return false;
    if (hasUnsavedEdits() && !await confirmDiscard()) return false;

    ending = true;
    try {
      await logout();
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
    clearUnsavedEdits();
    reload();
    return true;
  }

  return Object.freeze({ signOut, expire });
}

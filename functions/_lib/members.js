// Helpers for company member self-management (#17).

// Company member roles are 'admin' or 'buyer' (anything else → buyer).
export function normalizeMemberRole(value) {
  return value === 'admin' ? 'admin' : 'buyer';
}

// True if targetId is the company's ONLY admin — demoting or removing them would
// orphan the company with no admin. Used to block self-lockout.
export function isLastAdmin(members, targetId) {
  const admins = (members || []).filter((m) => m && m.role === 'admin');
  return admins.length === 1 && String(admins[0].id) === String(targetId);
}

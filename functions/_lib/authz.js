// Pure platform-staff allow-list decision for /api/admin/* (no I/O, no SDK import).
// requireStaff() in supabase.js resolves the user via Supabase Auth, then delegates the
// email allow-list decision here so it can be unit-tested (tests/authz-lib.test.mjs)
// without a live auth round-trip. ADMIN_EMAILS is authoritative; ADMIN_EMAIL is a
// single-value fallback. The profiles.is_staff DB fallback stays in requireStaff.

// Comma-separated ADMIN_EMAILS (or ADMIN_EMAIL) → trimmed, lowercased, non-empty, deduped.
export function parseAdminEmails(env) {
  const raw = (env?.ADMIN_EMAILS || env?.ADMIN_EMAIL || "");
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(list)];
}

// Case-insensitive membership test. Empty/blank email never matches.
export function isStaffEmail(email, env) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return parseAdminEmails(env).includes(e);
}

// ---- Staff role tiers (#21) ----
// Platform-staff are no longer all-powerful: a role narrows what each staff member
// can do. ADMIN_EMAILS members and legacy is_staff rows resolve to 'owner' (full).
export const STAFF_ROLES = ["owner", "finance", "support", "read_only"];

// capability -> roles permitted. Only the dangerous/financial mutations are gated
// in this batch; everything else stays open to any staff (tightened in a follow-up).
const STAFF_CAPABILITIES = {
  "order.refund": ["owner", "finance"],
  "company.credit": ["owner", "finance"],
  "product.write": ["owner"],
  "user.role": ["owner"],
};

// Map a raw profiles.staff_role into a known role. Unknown/blank -> 'owner' so
// staff that predate tiers (no staff_role set) never silently lose access.
export function normalizeStaffRole(value) {
  const r = String(value || "").trim().toLowerCase();
  return STAFF_ROLES.includes(r) ? r : "owner";
}

// Can a staff role perform a capability? Unknown capability -> owner-only (fail-safe).
export function staffCan(role, capability) {
  const allowed = STAFF_CAPABILITIES[capability];
  if (!allowed) return role === "owner";
  return allowed.includes(role);
}

// Baseline write gate: read_only staff may never mutate. Every admin mutation path
// checks this; fine-grained staffCan() then narrows specific dangerous actions.
export function staffCanWrite(role) {
  return role !== "read_only";
}

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
// Platform staff require an explicit role. ADMIN_EMAILS remains the separate root
// operator authority; database staff never inherit owner from missing data.
export const STAFF_ROLES = ["owner", "finance", "support", "read_only"];

// capability -> roles permitted. Only the dangerous/financial mutations are gated
// in this batch; everything else stays open to any staff (tightened in a follow-up).
const STAFF_CAPABILITIES = {
  "admin.write": ["owner", "finance", "support"],
  "order.read": ["owner", "finance", "support", "read_only"],
  "order.write": ["owner", "finance", "support"],
  "order.delete": ["owner"],
  "order.refund": ["owner", "finance"],
  "company.credit": ["owner", "finance"],
  "promotion.write": ["owner", "finance"],
  "company.view_as": ["owner", "finance", "support"],
  "prospect.write": ["owner", "finance", "support"],
  "prospect.delete": ["owner"],
  "product.write": ["owner"],
  "content.assets": ["owner"],
  "content.publish": ["owner"],
  "content.review": ["owner"],
  "content.write": ["owner"],
  "integration.configure": ["owner"],
  "user.manage": ["owner"],
  "user.role": ["owner"],
};

// Map a raw profiles.staff_role into a known role. Unknown/blank fails closed.
export function normalizeStaffRole(value) {
  const r = String(value || "").trim().toLowerCase();
  return STAFF_ROLES.includes(r) ? r : null;
}

export function platformStaffRole(profile) {
  if (profile?.is_staff !== true) return null;
  return normalizeStaffRole(profile.staff_role);
}

// Can a staff role perform a capability? Unknown capability -> owner-only (fail-safe).
export function staffCan(role, capability) {
  const allowed = STAFF_CAPABILITIES[capability];
  if (!allowed) return role === "owner";
  return allowed.includes(role);
}

// Baseline write gate: only explicit write roles may mutate. Every admin mutation
// path checks this; fine-grained staffCan() then narrows dangerous actions.
export function staffCanWrite(role) {
  return ["owner", "finance", "support"].includes(role);
}

// Safe client-facing access summary. API handlers remain authoritative; this only
// lets the admin UI explain and disable unavailable actions before a 403 occurs.
export function staffAccessSummary(role, email = "") {
  const normalizedRole = normalizeStaffRole(role);
  return {
    role: normalizedRole,
    email: String(email || "").trim().toLowerCase(),
    can_write: staffCanWrite(normalizedRole),
    capabilities: Object.keys(STAFF_CAPABILITIES).filter((capability) => staffCan(normalizedRole, capability)),
  };
}

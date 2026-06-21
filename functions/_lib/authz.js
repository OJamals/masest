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

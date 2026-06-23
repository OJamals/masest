import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin users endpoint manages company member roles and invites", () => {
  const endpoint = new URL("functions/api/admin/users.js", root);
  assert.equal(existsSync(endpoint), true, "admin users endpoint should exist");
  const src = read("functions/api/admin/users.js");

  assert.match(src, /requireStaff/, "endpoint must be staff-gated");
  assert.match(src, /action === 'set_role'/, "endpoint should support role changes");
  assert.match(src, /\.from\('profiles'\)/, "role changes should update profiles");
  assert.match(src, /\.eq\('company_id', companyId\)/, "role changes should be company-scoped");
  assert.match(src, /action === 'resend_invite'/, "endpoint should resend pending invites");
  assert.match(src, /company_invites/, "invite actions should use company_invites");
  assert.match(src, /sendEmail/, "resend invite should use logged email backbone");
  assert.match(src, /category:\s*'team'/, "invite email should be logged as team email");
  assert.match(src, /action === 'revoke_invite'/, "endpoint should revoke pending invites");
});

test("admin company detail exposes member role and invite actions", () => {
  // Company detail (members/invites + their wiring) moved into the companies module (#36 split).
  const src = read("js/admin/companies.js");

  assert.match(src, /company-members/, "detail panel should render member management");
  assert.match(src, /data-member-role/, "member role select should be stable");
  assert.match(src, /data-member-save/, "member role save action should be stable");
  assert.match(src, /company-invites/, "detail panel should render pending invites");
  assert.match(src, /data-invite-resend/, "pending invite resend action should be stable");
  assert.match(src, /data-invite-revoke/, "pending invite revoke action should be stable");
  assert.match(src, /wireCompanyUserActions\(/, "member/invite actions should be wired after render");
  assert.match(src, /\/api\/admin\/users/, "UI actions should call admin users endpoint");
});
test("admin invite resend only targets pending invites", () => {
  const src = read("functions/api/admin/users.js");
  const resendBlock = src.slice(
    src.indexOf("action === 'resend_invite'"),
    src.indexOf("action === 'revoke_invite'"),
  );

  assert.match(resendBlock, /status\s*!==\s*['"]pending['"]/, "resend should reject non-pending invites");
  assert.match(resendBlock, /pending_invite_not_found/, "resend should use pending-invite error copy");
});

test("admin detail action groups have wrapped spacing", () => {
  const html = read("admin.html");
  assert.match(html, /\.company-detail-actions[^{}]*\{[^}]*display:\s*flex/s, "detail actions should use a flex row");
  assert.match(html, /\.company-detail-actions[^{}]*\{[^}]*flex-wrap:\s*wrap/s, "detail actions should wrap on narrow screens");
  assert.match(html, /\.company-user-actions[^{}]*\{[^}]*display:\s*flex/s, "member invite actions should align");
});

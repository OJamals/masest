// Tenant-isolation contract for /api/account/*. Every account route must authenticate
// the caller (userFromRequest -> 401) and scope all data access to the caller's own
// company or user id — never to a raw client-supplied id alone. Routes are discovered
// from disk so a future endpoint that forgets to scope its query (IDOR regression) fails
// this suite automatically.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ACCOUNT_DIR = new URL("../functions/api/account/", import.meta.url);
const read = (name) => readFileSync(new URL(name, ACCOUNT_DIR), "utf8");
const ACCOUNT_ROUTES = readdirSync(ACCOUNT_DIR).filter((f) => f.endsWith(".js"));

// Self/tenant scoping primitives. A route is considered scoped if it constrains queries
// by the resolved company (requireCompany / .eq('company_id', ...)) or by
// the auth user id. requireCompany resolves the caller's company from their session, so a
// route built on it is tenant-scoped by construction.
// account/quotes.js scopes by the AUTH email instead: quote requests are submitted
// through the public form (often before any account or company exists), so the only
// tenant key is the email — taken from user.email, never from client input. The
// pattern below matches exactly that shape (`escapeLike(email)` where email is the
// auth-derived local) so a route filtering by a client-supplied email still fails.
const SCOPE_RE = /require(?:Company|CommerceUser)\(|\.eq\(\s*'company_id'|\.eq\(\s*'id'\s*,\s*user\.id|\.eq\(\s*'user_id'\s*,\s*user\.id|company_id\s*,\s*role|\.ilike\(\s*'email'\s*,\s*escapeLike\(email\)\s*\)|repository\.(?:listForUser|findRequest)\(\s*user\.id/;
const ACCOUNT_ERASURE_IMPORT_RE = /import\s+\{\s*deleteAccountUser\s*\}\s+from\s+['"][^'"]*_lib\/account-erasure\.js['"]/;
const ACCOUNT_ERASURE_CALL_RE = /await\s+deleteAccountUser\(\s*sb\s*,\s*user\.id\s*\)/;

function executableSource(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function usesSelfScopedAccountErasure(src) {
  const code = executableSource(src);
  return ACCOUNT_ERASURE_IMPORT_RE.test(code) && ACCOUNT_ERASURE_CALL_RE.test(code);
}

test("account route discovery finds the known endpoints", () => {
  assert.ok(ACCOUNT_ROUTES.length >= 10, `expected >=10 account routes, found ${ACCOUNT_ROUTES.length}`);
  for (const expected of ["orders.js", "order.js", "profile.js", "addresses.js"]) {
    assert.ok(ACCOUNT_ROUTES.includes(expected), `missing account route ${expected}`);
  }
});

test("every account route authenticates (requireCompany or userFromRequest) and 401s anon callers", () => {
  for (const name of ACCOUNT_ROUTES) {
    const src = read(name);
    // Routes authenticate either via the requireCompany wrapper (which does
    // profile/company lookup internally) or the raw primitive.
    const usesWrapper = /require(?:Company|CommerceUser)\(\s*request\s*,\s*env\s*\)/.test(src);
    const usesRaw = /userFromRequest\(\s*request\s*,\s*env\s*\)/.test(src);
    assert.ok(usesWrapper || usesRaw,
      `account/${name} must authenticate via requireCompany or userFromRequest`);
    assert.match(src, /import\s*\{[^}]*\b(requireCompany|requireCommerceUser|userFromRequest)\b[^}]*\}\s*from\s*['"][^'"]*_lib\/supabase\.js['"]/,
      `account/${name} must import its auth primitive`);
    const guards401 = /if\s*\(\s*ctx\.error\s*\)\s*return\s+ctx\.error/.test(src)
      || /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401\s*,/.test(src);
    assert.ok(guards401, `account/${name} must reject anonymous callers (401)`);
  }
});

test("every account route scopes its queries by company or self", () => {
  for (const name of ACCOUNT_ROUTES) {
    const src = read(name);
    assert.ok(SCOPE_RE.test(src) || usesSelfScopedAccountErasure(src),
      `account/${name} must scope data access by company_id or the auth user id (IDOR risk)`);
  }
});

test("account deletion passes only the authenticated user id to the erasure helper", () => {
  const code = executableSource(read("delete.js"));
  assert.match(code, ACCOUNT_ERASURE_IMPORT_RE,
    "delete.js must import the shared account-erasure helper");
  assert.match(code, ACCOUNT_ERASURE_CALL_RE,
    "delete.js must erase the authenticated user, not a client-supplied id");
});

test("auth guard precedes any DB access inside the handler", () => {
  for (const name of ACCOUNT_ROUTES) {
    const src = read(name);
    const handlerMatch = src.match(
      /export\s+(?:async\s+)?function\s+(?:onRequest\w*|handleAccountDocumentRequests)/,
    );
    assert.ok(handlerMatch, `account/${name} must export an onRequest* handler`);
    const handler = src.slice(handlerMatch.index);

    // Guard = the requireCompany call (auth+company resolved before sb exists) or the
    // raw inline 401 check. Either must come before any DB access.
    let guardIdx = handler.search(/require(?:Company|CommerceUser)\(\s*request/);
    if (guardIdx < 0) guardIdx = handler.search(/if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401/);
    assert.ok(guardIdx >= 0, `account/${name} auth guard not found in handler body`);

    const dataIdx = handler.search(/\bsb\s*\.\s*(from|rpc)\(/);
    if (dataIdx >= 0) {
      assert.ok(guardIdx < dataIdx,
        `account/${name} queries the database before the auth guard`);
    }
  }
});

// Focused IDOR guard: account/order.js fetches a single order by a client-supplied id.
// That lookup MUST also be constrained to the caller's company, so a buyer cannot read
// another company's order by guessing/iterating ids.
test("account/order.js scopes the single-order lookup by company, not id alone", () => {
  const src = read("order.js");
  assert.match(src, /\.eq\(\s*'id'\s*,\s*id\s*\)/, "order.js must look up by the requested id");
  assert.match(src, /\.eq\(\s*'company_id'\s*,\s*companyId\s*\)/,
    "order.js must additionally constrain the lookup to the caller's company (IDOR guard)");
});

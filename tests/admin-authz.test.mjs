// Access-control contract for /api/admin/** (recursive). Every admin route is
// platform-staff-only: it MUST call requireStaff and reject (401 unauthenticated /
// 403 forbidden) BEFORE it touches the database — UNLESS it is one of the explicitly
// documented non-staff gates below, each protected by a different vetted mechanism
// (OAuth signed-state, shared cron secret) that this suite verifies instead.
//
// Routes are discovered from disk INCLUDING subdirectories (the qbo/ OAuth routes were
// previously invisible to this guard), so a newly-added admin endpoint that forgets its
// gate fails this suite automatically.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ADMIN_DIR = new URL("../functions/api/admin/", import.meta.url);
const read = (name) => readFileSync(new URL(name, ADMIN_DIR), "utf8");

function listRoutes(dirUrl, prefix = "") {
  const out = [];
  for (const ent of readdirSync(dirUrl, { withFileTypes: true })) {
    if (ent.isDirectory()) out.push(...listRoutes(new URL(`${ent.name}/`, dirUrl), `${prefix}${ent.name}/`));
    else if (ent.name.endsWith(".js")) out.push(`${prefix}${ent.name}`);
  }
  return out;
}
const ADMIN_ROUTES = listRoutes(ADMIN_DIR);

// Routes that legitimately run WITHOUT a staff session. Documented + verified here so the
// contract checks their specific protection rather than silently skipping them.
const NON_STAFF_GATES = {
  // Intuit OAuth redirect target — no staff session exists in the browser round-trip;
  // protected by HMAC signed-state verification (only staff can mint state via connect.js).
  "qbo/callback.js": /verifyQboState\(/,
};

// Routes allowed to touch the DB before the staff guard, ONLY inside a vetted gate.
const PRE_GUARD_DB_GATES = {
  // Automation sweep invoked by the CRM cron behind a constant-time shared-secret check.
  "quotes.js": /QUOTE_CRM_SECRET/,
};

// Detects the service-role CLIENT creation itself (adminClient(env)) — not only chained
// .from/.rpc — so a route that aliases `const sb = adminClient(env)` and hands it to a
// helper cannot slip a pre-guard DB call past this check (the gap that previously hid the
// quotes.js sweep from the guard-ordering assertion).
const DB_ACCESS = /\badminClient\(\s*env\s*\)|\bsb\s*\.\s*(?:from|rpc)\(/;

test("admin route discovery finds the known endpoints, including subdirectories", () => {
  assert.ok(ADMIN_ROUTES.length >= 15, `expected >=15 admin routes, found ${ADMIN_ROUTES.length}`);
  for (const expected of ["orders.js", "quotes.js", "products.js", "companies.js", "qbo/callback.js", "qbo/connect.js"]) {
    assert.ok(ADMIN_ROUTES.includes(expected), `missing admin route ${expected}`);
  }
});

test("every admin route imports and calls requireStaff (or is a documented non-staff gate)", () => {
  for (const name of ADMIN_ROUTES) {
    const src = read(name);
    if (name in NON_STAFF_GATES) {
      assert.match(src, NON_STAFF_GATES[name], `admin/${name} non-staff gate must enforce its documented protection`);
      continue;
    }
    assert.match(src, /import\s*\{[^}]*\brequireStaff\b[^}]*\}\s*from\s*['"][^'"]*_lib\/supabase\.js['"]/,
      `admin/${name} must import requireStaff from the shared lib`);
    assert.match(src, /requireStaff\(\s*request\s*,\s*env\s*\)/,
      `admin/${name} must call requireStaff(request, env)`);
  }
});

test("every staff-gated admin route returns 401 for anon and 403 for non-staff", () => {
  for (const name of ADMIN_ROUTES) {
    if (name in NON_STAFF_GATES) continue;
    const src = read(name);
    assert.match(src, /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401\s*,/, `admin/${name} must 401 when unauthenticated`);
    assert.match(src, /if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403\s*,/, `admin/${name} must 403 when authenticated but not staff`);
  }
});

test("admin staff guard precedes any DB access inside the handler", () => {
  for (const name of ADMIN_ROUTES) {
    const src = read(name);
    const handlerMatch = src.match(/export\s+(?:async\s+)?function\s+onRequest\w*/);
    assert.ok(handlerMatch, `admin/${name} must export an onRequest* handler`);
    const handler = src.slice(handlerMatch.index);
    const dataIdx = handler.search(DB_ACCESS);

    if (name in NON_STAFF_GATES) {
      // Non-staff gate: its documented protection must precede any DB access.
      const gateIdx = handler.search(NON_STAFF_GATES[name]);
      if (dataIdx >= 0) {
        assert.ok(gateIdx >= 0 && gateIdx < dataIdx,
          `admin/${name} accesses the database before its non-staff gate`);
      }
      continue;
    }

    const guardIdx = handler.search(/if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403/);
    assert.ok(guardIdx >= 0, `admin/${name} staff guard not found in handler body`);
    if (dataIdx >= 0 && dataIdx < guardIdx) {
      // DB before the staff guard is allowed ONLY for a documented secret-gated branch,
      // and only when that gate textually precedes the DB access.
      const gate = PRE_GUARD_DB_GATES[name];
      assert.ok(gate, `admin/${name} accesses the database before the staff guard (IDOR/authz bypass risk)`);
      assert.match(handler.slice(0, dataIdx), gate,
        `admin/${name} pre-guard DB access must sit behind its documented gate`);
    }
  }
});

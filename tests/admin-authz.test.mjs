// Access-control contract for /api/admin/*. Every admin route is platform-staff-only:
// it MUST call requireStaff and reject (401 unauthenticated / 403 forbidden) BEFORE it
// touches the database. Routes are discovered from disk, so a newly-added admin endpoint
// that forgets the gate fails this suite automatically (regression guard against a future
// unguarded admin route).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ADMIN_DIR = new URL("../functions/api/admin/", import.meta.url);
const read = (name) => readFileSync(new URL(name, ADMIN_DIR), "utf8");
const ADMIN_ROUTES = readdirSync(ADMIN_DIR).filter((f) => f.endsWith(".js"));

// Sanity: discovery actually found the known routes (guards against an empty glob
// silently "passing" zero files).
test("admin route discovery finds the known endpoints", () => {
  assert.ok(ADMIN_ROUTES.length >= 11, `expected >=11 admin routes, found ${ADMIN_ROUTES.length}`);
  for (const expected of ["orders.js", "quotes.js", "products.js", "companies.js"]) {
    assert.ok(ADMIN_ROUTES.includes(expected), `missing admin route ${expected}`);
  }
});

test("every admin route imports and calls requireStaff", () => {
  for (const name of ADMIN_ROUTES) {
    const src = read(name);
    assert.match(src, /import\s*\{[^}]*\brequireStaff\b[^}]*\}\s*from\s*['"][^'"]*_lib\/supabase\.js['"]/,
      `admin/${name} must import requireStaff from the shared lib`);
    assert.match(src, /requireStaff\(\s*request\s*,\s*env\s*\)/,
      `admin/${name} must call requireStaff(request, env)`);
  }
});

test("every admin route returns 401 for anon and 403 for non-staff", () => {
  for (const name of ADMIN_ROUTES) {
    const src = read(name);
    assert.match(src, /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401\s*,/,
      `admin/${name} must 401 when unauthenticated`);
    assert.match(src, /if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403\s*,/,
      `admin/${name} must 403 when authenticated but not staff`);
  }
});

// The gate must run BEFORE any DB access. Helper functions are defined above the
// handler in several routes (offers/orders/products), so we slice from the exported
// Cloudflare handler (onRequest*) and assert the staff guard precedes the first
// service-role data call *inside the handler*.
test("admin staff guard precedes any DB access inside the handler", () => {
  for (const name of ADMIN_ROUTES) {
    const src = read(name);
    const handlerMatch = src.match(/export\s+(?:async\s+)?function\s+onRequest\w*/);
    assert.ok(handlerMatch, `admin/${name} must export an onRequest* handler`);
    const handler = src.slice(handlerMatch.index);

    const guardIdx = handler.search(/if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403/);
    assert.ok(guardIdx >= 0, `admin/${name} staff guard not found in handler body`);

    // First service-role data operation within the handler body.
    const dataIdx = handler.search(/\bsb\s*\.\s*(from|rpc)\(|\badminClient\(\s*env\s*\)\s*\.\s*(from|rpc)\(/);
    if (dataIdx >= 0) {
      assert.ok(guardIdx < dataIdx,
        `admin/${name} accesses the database before the staff guard (IDOR/authz bypass risk)`);
    }
  }
});

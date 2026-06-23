import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const r = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ADMIN = r("../functions/api/admin/orders.js");
const ACCT_LIST = r("../functions/api/account/orders.js");
const ACCT_ONE = r("../functions/api/account/order.js");
const DASH = r("../js/dashboard.js");

// #99 shipment event history: tracking updates append an event; customer + admin
// read paths embed it; the customer dashboard renders the history.
test("update_tracking appends a shipment_events row", () => {
  assert.match(ADMIN, /from\('shipment_events'\)\s*\.insert\(\{[\s\S]*status: trackingStatus/);
});

test("customer + admin read paths embed shipment_events", () => {
  assert.match(ACCT_LIST, /shipment_events\(status,note,created_at\)/);
  assert.match(ACCT_ONE, /shipment_events\(status,note,created_at\)/);
  assert.match(ADMIN, /shipment_events\(status,carrier,tracking_number,note,created_at\)/);
});

test("dashboard renders the shipment history", () => {
  assert.match(DASH, /shipment_events \|\| \[\]/);
  assert.match(DASH, /ship-history/);
});

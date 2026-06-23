import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../functions/api/admin/orders.js", import.meta.url), "utf8");
const UI = readFileSync(new URL("../js/admin/orders.js", import.meta.url), "utf8");

// #95 per-order drill-down: endpoint serves single-order detail + staff timeline,
// and both list and detail expose the #27 backordered flag.
test("detail endpoint reads ?id, joins items+timeline, exposes backordered", () => {
  assert.match(API, /params\.get\('id'\)/);
  assert.match(API, /order_items\([^)]*backordered/);            // detail select
  assert.match(API, /from\('audit_log'\)[\s\S]*target_type', 'order'/); // timeline
  assert.match(API, /order_items\(sku,name,qty,unit_price,line_total,backordered\)/); // list select too
});

test("UI fetches detail by id and opens the modal with a backorder badge", () => {
  assert.match(UI, /data-order-detail/);
  assert.match(UI, /\/api\/admin\/orders\?id=/);
  assert.match(UI, /detailDialog\(/);
  assert.match(UI, /backordered \? ' <span class="badge badge-warning">backordered/);
});

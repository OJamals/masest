import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadOrderIntegrationTimeline } from '../functions/api/admin/orders.js';

const API = readFileSync(new URL("../functions/api/admin/orders.js", import.meta.url), "utf8");
const UI = readFileSync(new URL("../js/admin/orders.js", import.meta.url), "utf8");

// #95 per-order drill-down: endpoint serves single-order detail + staff timeline,
// and both list and detail expose the #27 backordered flag.
test("detail endpoint reads ?id, joins items+timeline, exposes backordered", () => {
  assert.match(API, /params\.get\('id'\)/);
  assert.match(API, /order_items\([^)]*backordered/);            // detail select
  assert.match(API, /from\('audit_log'\)[\s\S]*target_type', 'order'/); // timeline
  assert.match(API, /contains\('payload', \{ order_id: orderId \}\)/);
  assert.match(API, /contains\('provider_result', \{ order_id: orderId \}\)/);
  assert.match(API, /eq\('aggregate_type', 'shipment'\)/);
  assert.match(API, /integration_timeline/);
  assert.match(API, /order_financial_entries\(source,entry_type,provider_object_id,amount,currency,recognition_state,reason,metadata,created_at\)/);
  assert.match(API, /order_items\(sku,product_sku,name,qty,unit_price,line_total,backordered\)/); // list select too
});

test('order timeline resolves Stripe payload and ShipStation tracking/provider-result effects', async () => {
  const rows = {
    payload: [{ id: 'stripe-effect', event_id: 'stripe-event', effect_type: 'order_confirmation', status: 'completed', created_at: '2026-08-04T12:00:00Z' }],
    provider_result: [{ id: 'ship-effect', event_id: 'ship-event', effect_type: 'shipstation_tracking_projection', status: 'completed', provider_result: { order_id: 'order-1', applied: true }, created_at: '2026-08-04T13:00:00Z' }],
    shipment: [{ id: 'ship-effect', event_id: 'ship-event', effect_type: 'shipstation_tracking_projection', status: 'completed', provider_result: { order_id: 'order-1', applied: true }, created_at: '2026-08-04T13:00:00Z' }],
  };
  const effectQuery = () => {
    let kind;
    return {
      select() { return this; },
      contains(column) { kind = column; return this; },
      eq(column) { if (column === 'aggregate_type') kind = 'shipment'; return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: rows[kind] || [], error: null }); },
    };
  };
  const sb = {
    from(table) {
      if (table === 'integration_effects') return effectQuery();
      return {
        select() { return this; },
        in: async () => ({ data: [
          { id: 'stripe-event', provider: 'stripe', provider_event_type: 'checkout.session.completed' },
          { id: 'ship-event', provider: 'shipstation', provider_event_type: 'track' },
        ], error: null }),
      };
    },
  };
  const timeline = await loadOrderIntegrationTimeline(sb, 'order-1', 'TRACK-1');
  assert.deepEqual(timeline.map((item) => [item.id, item.provider]), [
    ['ship-effect', 'shipstation'],
    ['stripe-effect', 'stripe'],
  ]);
});

test("UI fetches detail by id and opens the modal with a backorder badge", () => {
  assert.match(UI, /data-order-detail/);
  assert.match(UI, /\/api\/admin\/orders\?id=/);
  assert.match(UI, /detailDialog\(/);
  assert.match(UI, /Integration delivery/);
  assert.match(UI, /Financial evidence/);
  assert.match(UI, /pending carrier credit/);
  assert.match(UI, /backordered \? ' <span class="badge badge-warning">backordered/);
});

test('orders with immutable provider financial evidence return a stable delete conflict', () => {
  assert.match(API, /body\.action === 'delete_order'[\s\S]*?rpc\('delete_draft_order_atomic'/);
  assert.match(API, /'order_delete_forbidden'/);
  assert.match(API, /'order_delete_forbidden',[\s\S]*?\]\.includes\(code\)\) return 409/);
});

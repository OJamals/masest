import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadOrderIntegrationTimeline } from '../functions/api/admin/orders.js';
import { orderAdjustmentEvidence } from '../js/admin/orders.js';

const API = readFileSync(new URL("../functions/api/admin/orders.js", import.meta.url), "utf8");
const ORDER_OPERATIONS = readFileSync(new URL("../functions/_lib/staff-order-operations.js", import.meta.url), "utf8");
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

test('order timeline resolves provider effects and provider-neutral email telemetry', async () => {
  const rows = {
    payload: [{ id: 'stripe-effect', event_id: 'stripe-event', effect_type: 'order_confirmation', status: 'completed', provider_result: { provider_message_id: 'email-provider-1', http_status: 200 }, created_at: '2026-08-04T12:00:00Z' }],
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
      if (table === 'email_events') {
        return {
          select() { return this; },
          in: async () => ({ data: [{
            provider_message_id: 'email-provider-1',
            status: 'delivered',
            updated_at: '2026-08-04T12:02:00Z',
            created_at: '2026-08-04T12:00:01Z',
          }], error: null }),
        };
      }
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
  assert.deepEqual(timeline.find(({ id }) => id === 'stripe-effect').result, {
    applied: undefined,
    skipped: undefined,
    provider_message_id: 'email-provider-1',
    email_status: 'delivered',
    email_updated_at: '2026-08-04T12:02:00Z',
  });
});

test("UI fetches detail by id and opens the modal with a backorder badge", () => {
  assert.match(UI, /data-order-detail/);
  assert.match(UI, /\/api\/admin\/orders\?id=/);
  assert.match(UI, /detailDialog\(/);
  assert.match(UI, /Integration delivery/);
  assert.match(UI, /entry\.result\?\.email_status/);
  assert.match(UI, /Email/);
  assert.match(UI, /Financial evidence/);
  assert.match(UI, /pending carrier credit/);
  assert.match(UI, /backordered \? ' <span class="badge badge-warning">backordered/);
});

test('order detail exposes bounded promotion and account-credit evidence', () => {
  assert.deepEqual(orderAdjustmentEvidence([
    {
      provider: 'stripe',
      object_type: 'checkout_session',
      metadata: {
        promotion_code: 'SAVE20',
        promotion_discount_minor: 500,
        store_credit_minor: 1001,
      },
    },
  ]), {
    promotionCode: 'SAVE20',
    promotionDiscountMinor: 500,
    storeCreditMinor: 1001,
  });
  assert.deepEqual(orderAdjustmentEvidence([{
    provider: 'stripe',
    object_type: 'checkout_session',
    metadata: {
      promotion_discount_minor: -1,
      store_credit_minor: Number.MAX_SAFE_INTEGER + 1,
    },
  }]), {
    promotionCode: '',
    promotionDiscountMinor: 0,
    storeCreditMinor: 0,
  });
  assert.match(UI, /Promotion/);
  assert.match(UI, /Account credit/);
});

test('orders with immutable provider financial evidence return a stable delete conflict', () => {
  assert.match(ORDER_OPERATIONS, /body\?\.action === 'delete_order'[\s\S]*?rpc\('delete_draft_order_atomic'/);
  assert.match(ORDER_OPERATIONS, /'order_delete_forbidden'/);
  assert.match(ORDER_OPERATIONS, /'order_delete_forbidden',[\s\S]*?\]\.includes\(code\)\) return 409/);
});

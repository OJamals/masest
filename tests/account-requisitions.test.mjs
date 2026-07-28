import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeCartQuantities } from "../functions/_lib/order-shape.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("saved requisitions reuse canonical cart validation", () => {
  assert.deepEqual(
    { ...normalizeCartQuantities([{ sku: "vk-5", qty: 2 }, { sku: "vk-5", qty: 3 }]) },
    { "vk-5": 5 },
  );
  assert.equal(normalizeCartQuantities([{ sku: "vk-5", qty: 0 }]), null);
  assert.equal(normalizeCartQuantities([{ sku: "x".repeat(81), qty: 1 }]), null);
  assert.equal(normalizeCartQuantities(Array.from({ length: 51 }, (_, index) => ({ sku: `vk-${index}`, qty: 1 }))), null);
});

test("requisitions are named buyer-owned cart orders with erasure-safe cleanup", () => {
  const schema = read("supabase/schema-requisitions.sql");
  const base = read("supabase/schema.sql");
  const erasure = read("supabase/schema-account-erasure.sql");

  assert.match(schema, /add column if not exists requisition_name text/);
  assert.match(schema, /where status = 'cart'/);
  assert.match(base, /requisition_name\s+text/);
  assert.match(erasure, /delete from public\.orders[\s\S]*status = 'cart'/);
});

test("account orders owns create, list, and delete for saved requisitions", () => {
  const route = read("functions/api/account/orders.js");

  assert.match(route, /export async function onRequestPost/);
  assert.match(route, /export async function onRequestDelete/);
  assert.match(route, /requisition_name/);
  assert.match(route, /\.eq\('user_id', user\.id\)/);
  assert.match(route, /\.eq\('status', 'cart'\)/);
  assert.match(route, /too_many_requisitions/);
  assert.match(route, /normalizeCartQuantities/);
  assert.match(route, /tierPriceMap/);
  assert.match(route, /readBoundedJson/);
  assert.match(route, /\.rpc\('save_requisition'/);
  assert.match(read("supabase/schema-requisitions.sql"), /jsonb_to_recordset/);
  assert.match(read("functions/api/account/order.js"), /order\.status === 'cart' && order\.user_id !== user\.id/);
});

test("cart saves named requisitions and dashboard restores or deletes them", () => {
  const cart = read("cart.html");
  const dashboard = read("js/dashboard.js");

  assert.match(cart, /id="saveRequisitionForm"/);
  assert.match(cart, /api\("\/api\/account\/orders",\s*\{\s*method:\s*"POST"/);
  assert.match(dashboard, /Saved requisitions/);
  assert.match(dashboard, /data-use-requisition/);
  assert.match(dashboard, /method:\s*'DELETE'/);
  assert.match(dashboard, /\/api\/account\/order/);
});

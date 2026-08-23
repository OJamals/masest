import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  reversalWorkflowEvidence,
  terminalFulfillmentNote,
} from "../js/admin/orders.js";
import { adminCatalogHref } from "../js/main/commerce-ui.js";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("staff product actions deep-link to the exact CMS catalog row", () => {
  assert.equal(adminCatalogHref("hcr-t16"), "/admin.html?product_q=hcr-t16#products");
  assert.equal(adminCatalogHref("crhd"), "/admin.html?product_q=cr-hd#products");
});

test("terminal orders replace stale fulfillment controls with closed-state truth", async () => {
  assert.equal(
    terminalFulfillmentNote({ status: "refunded", tracking_status: "processing" }),
    "Fulfillment closed. No shipment or tracking number was recorded.",
  );
  assert.equal(
    terminalFulfillmentNote({
      status: "cancelled",
      tracking_status: "shipped",
      tracking_number: "1Z999",
    }),
    "Fulfillment closed. Last recorded shipment state: shipped.",
  );
  assert.equal(terminalFulfillmentNote({ status: "paid", tracking_status: "processing" }), "");

  const source = await read("js/admin/orders.js");
  assert.match(source, /terminalFulfillmentNote\(order\)\s*\?[^:]+:\s*trackingControls\(order\)/s);
});

test("order details summarize canonical refund and cancellation effect graphs", () => {
  const refundTypes = [
    "order_refund",
    "order_restock",
    "order_accounting_reversal",
    "order_reversal_complete",
    "order_refund_email",
  ];
  const complete = reversalWorkflowEvidence(
    { status: "refunded" },
    refundTypes.map((effect_type) => ({ effect_type, status: "completed" })),
  );
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);

  const legacy = reversalWorkflowEvidence({ status: "refunded" }, []);
  assert.equal(legacy.complete, false);
  assert.ok(legacy.missing.includes("order_refund"));
  assert.ok(legacy.missing.includes("order_refund_email"));
});

test("marine aliases remain visible after buyers open canonical product pages", async () => {
  const registry = JSON.parse(await read("data/industry-applications.json"));
  const marine = registry.industries.find((industry) => industry.slug === "marine");
  assert.ok(marine?.approved_product_names?.length, "marine product registry missing");

  for (const product of marine.approved_product_names) {
    const page = await read(`products/${product.base_product}.html`);
    assert.match(page, /class="product-market-alias"/);
    assert.ok(page.includes(product.name.replaceAll("&", "&amp;")), `${product.base_product} omits ${product.name}`);
    assert.ok(page.includes(product.job_focus), `${product.base_product} omits marine job focus`);
    assert.match(page, /href="\.\.\/industries\/marine#products-for-this-industry"/);
  }
});

test("cart removal is recoverable and product names return to selection", async () => {
  const cart = await read("cart.html");
  assert.match(cart, /id="cartUndo"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(cart, /data-undo-cart/);
  assert.match(cart, /Removed[\s\S]+Undo/);
  assert.match(cart, /class="cart-line-product-link"/);
  assert.match(cart, /productPath\(meta\?\.productSku,\s*context\)/);
});

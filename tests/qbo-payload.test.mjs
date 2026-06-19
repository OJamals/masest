import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoicePayload, buildInvoicePaymentPayload, buildSalesReceiptPayload } from "../functions/_lib/qbo.js";

const order = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  tax: 7.5,
  total: 107.5,
};

const items = [
  { sku: "crhd", name: "CR-HD - 5 gal", qty: 2, unit_price: 25, line_total: 50 },
  { sku: "sar", name: "SAR - 5 gal", qty: 1, unit_price: 50, line_total: 50 },
];

const itemRefs = { crhd: "101", sar: "102" };

test("sales receipt payload maps one QBO line per order item", () => {
  const payload = buildSalesReceiptPayload({ order, items, customerRef: "55", itemRefs });

  assert.equal(payload.CustomerRef.value, "55");
  assert.equal(payload.DocNumber, "a1b2c3d4e5f67890abcde");
  assert.equal(payload.PrivateNote, `MASEST order ${order.id}`);
  assert.equal(payload.Line.length, 2);
  assert.equal(payload.Line[0].DetailType, "SalesItemLineDetail");
  assert.equal(payload.Line[0].Amount, 50);
  assert.equal(payload.Line[0].Description, "CR-HD - 5 gal");
  assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, "101");
  assert.equal(payload.Line[0].SalesItemLineDetail.Qty, 2);
  assert.equal(payload.Line[0].SalesItemLineDetail.UnitPrice, 25);
  assert.equal(payload.TxnTaxDetail.TotalTax, 7.5);
});

test("invoice payload shares document structure and carries balance due", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });

  assert.equal(payload.CustomerRef.value, "55");
  assert.equal(payload.DocNumber, "a1b2c3d4e5f67890abcde");
  assert.equal(payload.Line[1].SalesItemLineDetail.ItemRef.value, "102");
  assert.equal(payload.TxnTaxDetail.TotalTax, 7.5);
  assert.equal(payload.Balance, 107.5);
});

test("invoice payload enables QuickBooks online card and ACH payments", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });

  assert.equal(payload.AllowOnlinePayment, true);
  assert.equal(payload.AllowOnlineCreditCardPayment, true);
  assert.equal(payload.AllowOnlineACHPayment, true);
});

test("invoice payment payload links Stripe payment to the QuickBooks invoice", () => {
  const payload = buildInvoicePaymentPayload({
    order: { ...order, stripe_payment_intent: "pi_123" },
    customerRef: "55",
    invoiceId: "inv-900",
  });

  assert.equal(payload.CustomerRef.value, "55");
  assert.equal(payload.TotalAmt, 107.5);
  assert.equal(payload.PaymentRefNum, "pi_123");
  assert.equal(payload.Line[0].Amount, 107.5);
  assert.equal(payload.Line[0].LinkedTxn[0].TxnId, "inv-900");
  assert.equal(payload.Line[0].LinkedTxn[0].TxnType, "Invoice");
});

test("payload builder fails clearly when an item ref is missing", () => {
  assert.throws(
    () => buildSalesReceiptPayload({ order, items, customerRef: "55", itemRefs: { crhd: "101" } }),
    /qbo_item_ref_missing:sar/,
  );
});

test("QBO document payloads carry buyer email when present", () => {
  const emailedOrder = { ...order, customer_email: "buyer@example.test" };
  assert.deepEqual(
    buildInvoicePayload({ order: emailedOrder, items, customerRef: "55", itemRefs }).BillEmail,
    { Address: "buyer@example.test" },
  );
  assert.deepEqual(
    buildSalesReceiptPayload({ order: emailedOrder, items, customerRef: "55", itemRefs }).BillEmail,
    { Address: "buyer@example.test" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildInvoicePayload,
  buildInvoicePaymentPayload,
  qboCustomerPayload,
  qboItemType,
  subscriptionItemsForQbo,
  subscriptionOrderForQbo,
} from "../functions/_lib/qbo.js";

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

test("invoice payload maps one QBO line per order item", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });

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
    () => buildInvoicePayload({ order, items, customerRef: "55", itemRefs: { crhd: "101" } }),
    /qbo_item_ref_missing:sar/,
  );
});

test("QBO document payloads carry buyer email when present", () => {
  const emailedOrder = { ...order, customer_email: "buyer@example.test" };
  assert.deepEqual(
    buildInvoicePayload({ order: emailedOrder, items, customerRef: "55", itemRefs }).BillEmail,
    { Address: "buyer@example.test" },
  );
});

// #41: physical goods must not be QBO 'Service' items (wrong COGS/inventory).
test("qboItemType defaults tangible goods to NonInventory, services to Service", () => {
  assert.equal(qboItemType({ sku: 'cr-hd' }), 'NonInventory');
  assert.equal(qboItemType({ sku: 'cr-hd', type: 'service' }), 'Service');
  assert.equal(qboItemType({ sku: 'x', mode: 'quote' }), 'Service');
  assert.equal(qboItemType({ sku: 'x', mode: 'buy' }), 'NonInventory');
});

test("findOrCreateItem no longer hardcodes Type:'Service' + SalesReceipt stub removed", () => {
  const src = readFileSync(new URL('../functions/_lib/qbo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /buildSalesReceiptPayload/, 'dead SalesReceipt stub must be gone');
  assert.match(src, /Type:\s*qboItemType\(/, 'item type must be derived, not hardcoded Service');
});

test("business customers carry Stripe and billing identity into QuickBooks", () => {
  assert.deepEqual(qboCustomerPayload({
    key: "company:co-1",
    displayName: "O'Brien Industrial",
    email: "billing@example.test",
    phone: "+1 313 555 0199",
    stripeCustomerId: "cus_123",
    billingAddress: {
      line1: "100 Main St",
      line2: "Suite 4",
      city: "Detroit",
      state: "MI",
      zip: "48201",
      country: "US",
    },
  }), {
    DisplayName: "O'Brien Industrial",
    CompanyName: "O'Brien Industrial",
    PrimaryEmailAddr: { Address: "billing@example.test" },
    PrimaryPhone: { FreeFormNumber: "+1 313 555 0199" },
    BillAddr: {
      Line1: "100 Main St",
      Line2: "Suite 4",
      City: "Detroit",
      CountrySubDivisionCode: "MI",
      PostalCode: "48201",
      Country: "US",
    },
    Notes: "MASEST company co-1; Stripe customer cus_123",
  });
});

test("Stripe program invoices reuse the invoice plus payment accounting path", () => {
  const row = {
    stripe_invoice_id: "in_123",
    stripe_subscription_id: "sub_123",
    stripe_customer_id: "cus_123",
    stripe_payment_intent: "pi_123",
    company_id: "co-1",
    customer_email: "billing@example.test",
    tier: "Gold",
    description: "VertKleen Gold program",
    subtotal: 100,
    tax: 9,
    total: 109,
    currency: "usd",
  };
  assert.deepEqual(subscriptionOrderForQbo(row), {
    id: "in_123",
    company_id: "co-1",
    customer_email: "billing@example.test",
    payment_method: "stripe",
    stripe_payment_intent: "pi_123",
    subtotal: 100,
    tax: 9,
    total: 109,
    currency: "usd",
    qbo_private_note: "Stripe subscription invoice in_123 (sub_123)",
    qbo_payment_note: "Stripe payment for subscription invoice in_123",
  });
  assert.deepEqual(subscriptionItemsForQbo(row), [{
    sku: "program:gold",
    name: "VertKleen Gold program",
    type: "service",
    qty: 1,
    unit_price: 100,
    line_total: 100,
  }]);
});

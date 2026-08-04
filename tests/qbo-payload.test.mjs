import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildInvoicePayload,
  buildInvoicePaymentPayload,
  qboCustomerPayload,
  qboItemsWithShipping,
  qboItemType,
  subscriptionItemsForQbo,
  subscriptionOrderForQbo,
} from "../functions/_lib/qbo.js";

const order = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  order_number: "MST-00000123",
  tax: 7.5,
  total: 107.5,
};

const items = [
  { sku: "crhd", name: "CR-HD - 5 gal", qty: 2, unit_price: 25, line_total: 50 },
  { sku: "sar", name: "SAR - 5 gal", qty: 1, unit_price: 50, line_total: 50 },
];

const itemRefs = { crhd: "101", sar: "102" };
const qboSync = readFileSync(new URL("../functions/api/qbo-sync.js", import.meta.url), "utf8");

test("invoice payload maps one QBO line per order item", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });

  assert.equal(payload.CustomerRef.value, "55");
  assert.equal(payload.DocNumber, order.order_number);
  assert.equal(payload.PrivateNote, `MASEST order ${order.order_number}`);
  assert.equal(payload.Line.length, 2);
  assert.equal(payload.Line[0].DetailType, "SalesItemLineDetail");
  assert.equal(payload.Line[0].Amount, 50);
  assert.equal(payload.Line[0].Description, "CR-HD - 5 gal");
  assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, "101");
  assert.equal(payload.Line[0].SalesItemLineDetail.Qty, 2);
  assert.equal(payload.Line[0].SalesItemLineDetail.UnitPrice, 25);
  assert.equal(payload.TxnTaxDetail.TotalTax, 7.5);
});

test("invoice private note carries the customer purchase-order reference", () => {
  const payload = buildInvoicePayload({
    order: { ...order, purchase_order_number: "PO-1042" },
    items,
    customerRef: "55",
    itemRefs,
  });
  assert.equal(payload.PrivateNote, `MASEST order ${order.order_number}; Customer PO PO-1042`);
});

test("QBO order items add one shipping line for the Stripe shipping charge", () => {
  assert.deepEqual(qboItemsWithShipping(items, { shipping: 12.5 }), [
    ...items,
    { sku: "MASEST-SHIPPING", name: "Shipping", qty: 1, unit_price: 12.5, line_total: 12.5 },
  ]);
  assert.equal(qboItemsWithShipping(items, { shipping: 0 }), items);
  assert.equal((qboSync.match(/qboItemsWithShipping\(/g) || []).length, 2);
});

test("invoice payload shares document structure and carries balance due", () => {
  const payload = buildInvoicePayload({ order, items, customerRef: "55", itemRefs });

  assert.equal(payload.CustomerRef.value, "55");
  assert.equal(payload.DocNumber, order.order_number);
  assert.equal(payload.Line[1].SalesItemLineDetail.ItemRef.value, "102");
  assert.equal(payload.TxnTaxDetail.TotalTax, 7.5);
  assert.equal(payload.Balance, 107.5);
});

test("invoice payload records the Stripe promotion as a fixed discount line", () => {
  const discountedOrder = { ...order, tax: 0, total: 3.85 };
  const discountedItems = [
    { sku: "crhd", name: "CR-HD - 1 gal", qty: 1, unit_price: 19.27, line_total: 19.27 },
  ];
  const payload = buildInvoicePayload({
    order: discountedOrder,
    items: discountedItems,
    customerRef: "55",
    itemRefs,
  });

  assert.equal(payload.Line.length, 2);
  assert.equal(payload.Line[1].DetailType, "DiscountLineDetail");
  assert.equal(payload.Line[1].Amount, 15.42);
  assert.equal(payload.Line[1].DiscountLineDetail.PercentBased, false);
  assert.equal(Number((payload.Line[0].Amount - payload.Line[1].Amount + payload.TxnTaxDetail.TotalTax).toFixed(2)), 3.85);
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
  assert.equal(payload.PrivateNote, `Stripe payment for MASEST order ${order.order_number}`);
  assert.equal(payload.Line[0].Amount, 107.5);
  assert.equal(payload.Line[0].LinkedTxn[0].TxnId, "inv-900");
  assert.equal(payload.Line[0].LinkedTxn[0].TxnType, "Invoice");
});

test("invoice payment reference fits QuickBooks' 21-character limit", () => {
  const stripePaymentIntent = "pi_3TvoHQHfKF76gAoJ12345678";
  const payload = buildInvoicePaymentPayload({
    order: { ...order, stripe_payment_intent: stripePaymentIntent },
    customerRef: "55",
    invoiceId: "inv-900",
  });

  assert.equal(payload.PaymentRefNum, stripePaymentIntent.slice(0, 21));
  assert.equal(payload.PaymentRefNum.length, 21);
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

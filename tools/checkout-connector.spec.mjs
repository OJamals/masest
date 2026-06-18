import { expect, test } from "@playwright/test";
import { buildStripeCheckoutSessionParams, buyerEmailFromStripeSession } from "../functions/_lib/checkout-session.js";

test("checkout connector carries buyer email and cart metadata into Stripe", () => {
  const params = buildStripeCheckoutSessionParams({
    appUrl: "https://masest.co",
    email: "buyer@example.com",
    companyId: "company_123",
    sellable: [
      { sku: "crhd", name: "VertKleen CR-HD", price: 12.5, currency: "usd", stripe_price_id: null },
      { sku: "hcr", name: "VertKleen HCR", price: 10, currency: "usd", stripe_price_id: "price_hcr" },
    ],
    qtyBySku: { crhd: 4, hcr: 2 },
  });

  expect(params.mode).toBe("payment");
  expect(params.customer_email).toBe("buyer@example.com");
  expect(params.success_url).toBe("https://masest.co/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}");
  expect(params.cancel_url).toBe("https://masest.co/cart.html");
  expect(params.billing_address_collection).toBe("required");
  expect(params.metadata.company_id).toBe("company_123");
  expect(params.metadata.buyer_email).toBe("buyer@example.com");
  expect(JSON.parse(params.metadata.cart)).toEqual([
    { sku: "crhd", name: "VertKleen CR-HD", qty: 4, unit_price: 12.5 },
    { sku: "hcr", name: "VertKleen HCR", qty: 2, unit_price: 10 },
  ]);
  expect(params.line_items).toEqual([
    {
      quantity: 4,
      price_data: {
        currency: "usd",
        unit_amount: 1250,
        product_data: { name: "VertKleen CR-HD", metadata: { sku: "crhd" } },
        tax_behavior: "exclusive",
      },
    },
    { price: "price_hcr", quantity: 2 },
  ]);
});

test("checkout connector resolves buyer email from Stripe metadata fallback", () => {
  expect(buyerEmailFromStripeSession({
    customer_details: null,
    customer_email: "",
    metadata: { buyer_email: "buyer@example.com" },
  })).toBe("buyer@example.com");
});

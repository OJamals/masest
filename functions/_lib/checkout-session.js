// Pure helpers shared by checkout + webhook (no env, no I/O).
// taxEnabled gates Stripe automatic_tax (kept OFF until a Stripe origin address is
// set — flipping it on without one errors every checkout). When a customerId is
// supplied (B2B account) the session binds to that Stripe Customer so tax is computed
// against — and any tax_exempt='exempt' marking on — that customer; guests fall back
// to customer_email.
export function buildStripeCheckoutSessionParams({ appUrl, email, companyId, sellable, qtyBySku, taxEnabled = false, customerId = null }) {
  const cleanEmail = String(email || "").trim();
  const cart = sellable.map((product) => ({
    sku: product.sku,
    product_sku: product.product_sku,
    name: product.name,
    qty: qtyBySku[product.sku],
    unit_price: Number(product.price),
  }));

  const params = {
    mode: "payment",
    line_items: sellable.map((product) => (
      product.stripe_price_id
        ? { price: product.stripe_price_id, quantity: qtyBySku[product.sku] }
        : {
            quantity: qtyBySku[product.sku],
            price_data: {
              currency: product.currency || "usd",
              unit_amount: Math.round(Number(product.price) * 100),
              product_data: { name: product.name, metadata: { sku: product.sku } },
              tax_behavior: "exclusive",
            },
          }
    )),
    payment_method_types: ["card", "us_bank_account"],
    // Gated by STRIPE_TAX_ENABLED (see caller). Off by default; requires a Stripe
    // origin/head-office address before it can be flipped on, or sessions error.
    automatic_tax: { enabled: !!taxEnabled },
    shipping_address_collection: { allowed_countries: ["US"] },
    billing_address_collection: "required",
    success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/cart.html`,
    metadata: {
      company_id: companyId || "",
      buyer_email: cleanEmail,
      cart: JSON.stringify(cart),
    },
  };

  // A Checkout Session takes a Customer OR a customer_email, never both. B2B accounts
  // bind to their Customer (carries the tax_exempt marking); guests use the email.
  if (customerId) {
    params.customer = customerId;
    // Persist the address captured at checkout back onto the Customer so Stripe Tax
    // (and exemption) resolve on this and future invoices.
    params.customer_update = { address: "auto", shipping: "auto", name: "auto" };
  } else if (cleanEmail) {
    params.customer_email = cleanEmail;
  }

  return params;
}

export function buyerEmailFromStripeSession(session) {
  return String(
    session?.customer_details?.email
      || session?.customer_email
      || session?.metadata?.buyer_email
      || "",
  ).trim();
}

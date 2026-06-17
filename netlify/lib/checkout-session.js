export function buildStripeCheckoutSessionParams({ appUrl, email, companyId, sellable, qtyBySku }) {
  const cleanEmail = String(email || "").trim();
  const cart = sellable.map((product) => ({
    sku: product.sku,
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
    automatic_tax: { enabled: true },
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

  if (cleanEmail) params.customer_email = cleanEmail;

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

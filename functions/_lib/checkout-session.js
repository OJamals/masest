// Pure helpers shared by checkout + webhook (no env, no I/O).
// taxEnabled gates Stripe automatic_tax (kept OFF until a Stripe origin address is
// set — flipping it on without one errors every checkout). When a customerId is
// supplied (B2B account) the session binds to that Stripe Customer so tax is computed
// against — and any tax_exempt='exempt' marking on — that customer; guests fall back
// to customer_email.
// Stripe caps every metadata value at 500 characters, so the cart is stored in a
// compact shape (short keys, no display names — the webhook re-derives names from
// product_variants) and split across cart, cart2, cart3… keys. 40 chunks × 450 chars
// comfortably holds 300+ cart lines while staying under Stripe's 50-key limit.
const CART_CHUNK_SIZE = 450;
const CART_MAX_CHUNKS = 20;

export function normalizePurchaseOrderNumber(value) {
  if (value == null) return { value: null };
  if (typeof value !== "string") return { error: "invalid_purchase_order_number" };
  const normalized = value.trim();
  if (!normalized) return { value: null };
  if (normalized.length > 64 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    return { error: "invalid_purchase_order_number" };
  }
  return { value: normalized };
}

export function parseStripeShippingRateIds(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.some((id) => !/^shr_[A-Za-z0-9]+$/.test(id))) return null;
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length <= 5 ? uniqueIds : null;
}

export function shippingRateIdsFromContentEntries(entries) {
  const active = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.payload?.active === true)
    .sort((a, b) => {
      const order = (Number(a?.payload?.sort_order) || 0) - (Number(b?.payload?.sort_order) || 0);
      return order || String(a?.slug || "").localeCompare(String(b?.slug || ""));
    })
    .map((entry) => entry.payload.stripe_rate_id);
  return parseStripeShippingRateIds(active.join(","));
}

export function cartMetadataEntries(cart) {
  const compact = JSON.stringify((cart || []).map((l) => ({
    s: l.sku,
    ps: l.product_sku || undefined,
    q: l.qty,
    p: l.unit_price,
    ...(l.backordered ? { b: 1 } : {}),
  })));
  if (compact.length > CART_CHUNK_SIZE * CART_MAX_CHUNKS) throw new Error("cart_too_large");
  const entries = {};
  for (let i = 0, pos = 0; pos < compact.length; i += 1, pos += CART_CHUNK_SIZE) {
    entries[i === 0 ? "cart" : `cart${i + 1}`] = compact.slice(pos, pos + CART_CHUNK_SIZE);
  }
  return entries;
}

export function buildStripeCheckoutSessionParams({
  appUrl,
  email,
  companyId,
  sellable,
  qtyBySku,
  taxEnabled = false,
  customerId = null,
  shippingRateIds = [],
  shippingSelection = null,
  purchaseOrderNumber = null,
  quoteId = null,
  quoteOrderId = null,
  allowPromotionCodes = true,
}) {
  const cleanEmail = String(email || "").trim();
  const cart = sellable.map((product) => ({
    sku: product.sku,
    product_sku: product.product_sku,
    name: product.name,
    qty: qtyBySku[product.sku],
    unit_price: Number(product.price),
    backordered: !!product.backordered,
  }));
  const selectedAddress = shippingSelection?.address || null;
  const selectedBillingAddress = shippingSelection?.billing_address || selectedAddress;
  const selectedRate = shippingSelection?.rate || null;
  const inlineShippingOption = selectedRate ? {
    shipping_rate_data: {
      type: "fixed_amount",
      display_name: [selectedRate.carrier_name, selectedRate.service_type].filter(Boolean).join(" — ") || "Shipping",
      fixed_amount: {
        amount: Math.max(0, Math.round(Number(selectedRate.amount_minor) || 0)),
        currency: selectedRate.currency || "usd",
      },
      ...(Number(selectedRate.delivery_days) > 0 ? {
        delivery_estimate: {
          maximum: { unit: "business_day", value: Math.ceil(Number(selectedRate.delivery_days)) },
        },
      } : {}),
      metadata: {
        provider: "shipengine",
        provider_rate_id: selectedRate.rate_id || "",
        carrier_id: selectedRate.carrier_id || "",
        service_code: selectedRate.service_code || "",
      },
    },
  } : null;

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
              product_data: {
                name: product.name,
                metadata: { sku: product.sku },
                // Stripe Tax: only flag explicitly non-taxable goods; taxable lines use the
                // account default tax code. (price_data lines only — Price-backed lines carry
                // their tax code on the Stripe Product.)
                ...(product.taxable === false ? { tax_code: "txcd_00000000" } : {}),
              },
              tax_behavior: "exclusive",
            },
          }
    )),
    payment_method_types: ["card", "us_bank_account"],
    // Lets buyers enter a Stripe promotion code at checkout (#97). Codes/coupons are
    // managed via /api/admin/coupons; Stripe validates expiry/usage/minimum. NET
    // on-account orders don't run through Checkout, so they don't take promo codes.
    allow_promotion_codes: !!allowPromotionCodes,
    // Gated by STRIPE_TAX_ENABLED (see caller). Off by default; requires a Stripe
    // origin/head-office address before it can be flipped on, or sessions error.
    automatic_tax: { enabled: !!taxEnabled },
    ...(selectedAddress ? {} : { shipping_address_collection: { allowed_countries: ["US"] } }),
    shipping_options: inlineShippingOption
      ? [inlineShippingOption]
      : shippingRateIds.map((shipping_rate) => ({ shipping_rate })),
    billing_address_collection: selectedBillingAddress ? "auto" : "required",
    success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/${selectedAddress ? "checkout.html" : "cart.html"}`,
    metadata: {
      company_id: companyId || "",
      buyer_email: cleanEmail,
      purchase_order_number: purchaseOrderNumber || "",
      quote_id: quoteId || "",
      quote_order_id: quoteOrderId || "",
      shipping_rate_id: selectedRate?.rate_id || "",
      shipping_carrier_id: selectedRate?.carrier_id || "",
      shipping_service_code: selectedRate?.service_code || "",
      ship_name: selectedAddress?.name || "",
      ship_company: selectedAddress?.company || "",
      ship_phone: selectedAddress?.phone || "",
      ship_address1: selectedAddress?.address1 || "",
      ship_address2: selectedAddress?.address2 || "",
      ship_city: selectedAddress?.city || "",
      ship_state: selectedAddress?.state || "",
      ship_postal_code: selectedAddress?.postal_code || "",
      ship_country: selectedAddress?.country || "",
      ship_residential: selectedAddress ? (selectedAddress.residential ? "yes" : "no") : "",
      billing_same_as_shipping: shippingSelection?.billing_same_as_shipping === false ? "no" : "yes",
      bill_address1: selectedBillingAddress?.address1 || "",
      bill_address2: selectedBillingAddress?.address2 || "",
      bill_city: selectedBillingAddress?.city || "",
      bill_state: selectedBillingAddress?.state || "",
      bill_postal_code: selectedBillingAddress?.postal_code || "",
      bill_country: selectedBillingAddress?.country || "",
      ...cartMetadataEntries(cart),
    },
  };

  // A Checkout Session takes a Customer OR a customer_email, never both. B2B accounts
  // bind to their Customer (carries the tax_exempt marking); guests use the email.
  if (customerId) {
    params.customer = customerId;
    // Persist the address captured at checkout back onto the Customer so Stripe Tax
    // (and exemption) resolve on this and future invoices.
    if (!selectedAddress) params.customer_update = { address: "auto", shipping: "auto", name: "auto" };
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

// Pure helpers shared by checkout + webhook (no env, no I/O).
// taxEnabled gates Stripe automatic_tax (kept OFF until a Stripe origin address is
// set — flipping it on without one errors every checkout). When a customerId is
// supplied (B2B account) the session binds to that Stripe Customer so tax is computed
// against — and any tax_exempt='exempt' marking on — that customer; guests fall back
// to customer_email.
// Stripe caps every metadata value at 500 characters, so the cart is stored in a
// compact shape (short keys, no display names — the webhook re-derives names from
// product_variants) and split across cart, cart2, cart3… keys. The Session carries 33
// fixed metadata keys, leaving at most 14 cart chunks under Stripe's 50-key limit.
import { checkoutFulfillmentStripeTransport } from './checkout-fulfillment-contract.js';
import { allocateStoreCredit } from './store-credit.js';

const CART_CHUNK_SIZE = 450;
const CART_MAX_CHUNKS = 14;

export function normalizeCheckoutBuyerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email)) {
    return { error: 'buyer_email_invalid' };
  }
  const at = email.lastIndexOf('@');
  if (at < 1 || at > 64 || at !== email.indexOf('@')) return { error: 'buyer_email_invalid' };
  const domain = email.slice(at + 1);
  if (domain.length > 253 || !domain.includes('.') || domain.split('.').some((label) => (
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))) return { error: 'buyer_email_invalid' };
  return { value: email };
}

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
  buyerUserId = null,
  sellable,
  qtyBySku,
  taxEnabled = false,
  customerId = null,
  shippingRateIds = [],
  shippingSelection = null,
  purchaseOrderNumber = null,
  quoteId = null,
  quoteOrderId = null,
  quoteCheckoutAttemptId = null,
  allowPromotionCodes = true,
  storeCredit = null,
}) {
  const buyerEmail = normalizeCheckoutBuyerEmail(email);
  if (buyerEmail.error) throw new Error(buyerEmail.error);
  const cleanEmail = buyerEmail.value;
  const cart = sellable.map((product) => ({
    sku: product.sku,
    product_sku: product.product_sku,
    name: product.name,
    qty: qtyBySku[product.sku],
    unit_price: Number(product.price),
    backordered: !!product.backordered,
  }));
  const {
    selectedAddress,
    selectedBillingAddress,
    shippingOption,
    metadata: fulfillmentMetadata,
  } = checkoutFulfillmentStripeTransport(shippingSelection);
  const storeCreditAmountMinor = Math.max(0, Number(storeCredit?.amountMinor) || 0);
  const creditAllocation = storeCreditAmountMinor > 0
    ? allocateStoreCredit(sellable, qtyBySku, storeCreditAmountMinor)
    : null;
  const checkoutLines = creditAllocation?.lines || sellable.map((product) => ({
    product,
    quantity: qtyBySku[product.sku],
    unitAmountMinor: Math.round(Number(product.price) * 100),
  }));

  const params = {
    mode: "payment",
    line_items: checkoutLines.map(({ product, quantity, unitAmountMinor }) => (
      product.stripe_price_id && !creditAllocation
        ? { price: product.stripe_price_id, quantity }
        : {
            quantity,
            price_data: {
              currency: product.currency || "usd",
              unit_amount: unitAmountMinor,
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
    shipping_options: shippingOption
      ? [shippingOption]
      : shippingRateIds.map((shipping_rate) => ({ shipping_rate })),
    billing_address_collection: selectedBillingAddress ? "auto" : "required",
    success_url: `${appUrl}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/${selectedAddress ? "checkout.html" : "cart.html"}`,
    metadata: {
      company_id: companyId || "",
      buyer_user_id: buyerUserId || "",
      buyer_email: cleanEmail,
      purchase_order_number: purchaseOrderNumber || "",
      quote_id: quoteId || "",
      quote_order_id: quoteOrderId || "",
      quote_checkout_attempt_id: quoteCheckoutAttemptId || "",
      store_credit_reservation_id: storeCredit?.reservationId || "",
      store_credit_amount_minor: creditAllocation ? String(creditAllocation.amountMinor) : "",
      ...fulfillmentMetadata,
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
  for (const candidate of [
    session?.metadata?.buyer_email,
    session?.customer_email,
    session?.customer_details?.email,
  ]) {
    const normalized = normalizeCheckoutBuyerEmail(candidate);
    if (normalized.value) return normalized.value;
  }
  return "";
}

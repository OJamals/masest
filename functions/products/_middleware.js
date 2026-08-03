import { buildProductOffers, injectProductOffers } from "../_lib/product-offer-jsonld.js";
import { loadPublicProductPricing } from "../_lib/public-product-pricing.js";

const PRODUCT_SKU_ALIASES = new Map([["crhd", "cr-hd"]]);

function productSkuFromUrl(url) {
  const match = new URL(url).pathname.match(/^\/products\/([a-z0-9-]+)\/?$/i);
  if (!match) return "";
  const routeSku = match[1].toLowerCase();
  return PRODUCT_SKU_ALIASES.get(routeSku) || routeSku;
}

export async function handleProductPage(context, { loadPricing = loadPublicProductPricing } = {}) {
  const productSku = productSkuFromUrl(context.request.url);
  const response = await context.next();
  if (!productSku || !response.ok || !/\btext\/html\b/i.test(response.headers.get("content-type") || "")) {
    return response;
  }

  let pricingResult;
  try {
    pricingResult = await loadPricing(context.env, productSku);
  } catch {
    return response;
  }
  if (pricingResult?.error || !pricingResult?.data) return response;

  const requestUrl = new URL(context.request.url);
  requestUrl.search = "";
  requestUrl.hash = "";
  requestUrl.pathname = requestUrl.pathname.replace(/\/$/, "");
  const offers = buildProductOffers({
    productSku,
    pageUrl: requestUrl.toString(),
    pricing: pricingResult.data,
  });
  if (!offers.length) return response;

  const original = response.clone();
  try {
    const html = await response.text();
    const rewritten = injectProductOffers(html, offers);
    if (rewritten === html) return original;

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("cache-control", "no-store");
    return new Response(rewritten, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return original;
  }
}

export function onRequestGet(context) {
  return handleProductPage(context);
}

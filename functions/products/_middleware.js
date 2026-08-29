import { buildProductOffers, injectProductOffers } from "../_lib/product-offer-jsonld.js";
import { productIsPublished } from "../_lib/product-publication.generated.js";
import { loadPublicProductPricing } from "../_lib/public-product-pricing.js";

const PRODUCT_SKU_ALIASES = new Map([["crhd", "cr-hd"]]);

function productSkuFromUrl(url) {
  const match = new URL(url).pathname.match(/^\/products\/([a-z0-9-]+)\/?$/i);
  if (!match) return "";
  const routeSku = match[1].toLowerCase();
  return PRODUCT_SKU_ALIASES.get(routeSku) || routeSku;
}

async function heldProductNotFoundResponse(context) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-robots-tag": "noindex",
  });

  try {
    const notFoundUrl = new URL("/404", context.request.url);
    const asset = await context.next(new Request(notFoundUrl, context.request));
    for (const [name, value] of asset.headers) headers.set(name, value);
    headers.delete("content-length");
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex");
    return new Response(asset.body, { status: 404, statusText: "Not Found", headers });
  } catch {
    return new Response("Not Found", { status: 404, statusText: "Not Found", headers });
  }
}

export async function handleProductPage(context, { loadPricing = loadPublicProductPricing } = {}) {
  const productSku = productSkuFromUrl(context.request.url);
  if (productSku && !productIsPublished(productSku)) {
    return heldProductNotFoundResponse(context);
  }
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

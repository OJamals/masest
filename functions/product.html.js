/* SQ-17: /product.html?sku=<id> is a legacy URL shape (old inbound links,
 * bookmarks, anything still indexed under it) from before the catalog moved to
 * /products/<id> routes. There is no product.html file any more, so every hit
 * on it 404s — this redirects it to the live route instead of losing that
 * traffic. Kept separate from functions/products/_middleware.js because that
 * one only ever sees requests already under /products/*; this path is outside
 * that tree.
 *
 * The alias mirrors PRODUCT_SKU_ALIASES in functions/products/_middleware.js,
 * inverted: that one maps route "crhd" to CMS sku "cr-hd" for pricing lookups;
 * this one maps a legacy ?sku=cr-hd query back to the "crhd" route. Every other
 * product's legacy sku already equals its route slug, so no table entry is
 * needed for them. */
const ROUTE_BY_LEGACY_SKU = new Map([["cr-hd", "crhd"]]);

export function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sku = (url.searchParams.get("sku") || "").trim().toLowerCase();

  // No sku at all: the old page had no catalog identity to redirect from, so
  // send the visitor to the catalog rather than a dead end.
  if (!sku) {
    return Response.redirect(new URL("/products", url.origin).toString(), 301);
  }

  // Route slugs are lowercase letters, digits, and hyphens only (see
  // functions/products/_middleware.js's own route pattern) — anything else in
  // the query string was never a real product identity.
  if (!/^[a-z0-9-]+$/.test(sku)) {
    return Response.redirect(new URL("/products", url.origin).toString(), 301);
  }

  const route = ROUTE_BY_LEGACY_SKU.get(sku) || sku;
  return Response.redirect(new URL(`/products/${route}`, url.origin).toString(), 301);
}

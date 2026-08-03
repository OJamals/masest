const SELLER = { "@type": "Organization", name: "MASEST Consulting LLC" };

function isProduct(node) {
  const type = node?.["@type"];
  return type === "Product" || (Array.isArray(type) && type.includes("Product"));
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function availabilityForVariant(variant) {
  if (!variant.track_stock || variant.stock == null || Number(variant.stock) >= 1) {
    return "https://schema.org/InStock";
  }
  return variant.allow_backorder
    ? "https://schema.org/BackOrder"
    : "https://schema.org/OutOfStock";
}

export function buildProductOffers({ productSku, pageUrl, pricing } = {}) {
  const currency = String(pricing?.currency || "usd").toUpperCase();
  return (pricing?.variants || [])
    .filter((variant) => {
      const price = Number(variant?.tiers?.retail);
      return variant?.product_sku === productSku
        && variant.active !== false
        && variant.product_mode === "buy"
        && Number.isFinite(price)
        && price > 0;
    })
    .map((variant) => ({
      "@type": "Offer",
      sku: variant.vsku,
      name: `${variant.product_name} — ${variant.label}`,
      price: Number(variant.tiers.retail).toFixed(2),
      priceCurrency: currency,
      availability: availabilityForVariant(variant),
      itemCondition: "https://schema.org/NewCondition",
      url: pageUrl,
      seller: SELLER,
    }));
}

export function injectProductOffers(html, offers) {
  if (!Array.isArray(offers) || offers.length === 0) return html;

  return String(html).replace(
    /<script\b([^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*)>([\s\S]*?)<\/script>/gi,
    (script, attributes, source) => {
      let schema;
      try {
        schema = JSON.parse(source);
      } catch {
        return script;
      }

      const nodes = Array.isArray(schema?.["@graph"]) ? schema["@graph"] : [schema];
      const products = nodes.filter(isProduct);
      if (!products.length) return script;
      for (const product of products) product.offers = offers;
      return `<script${attributes}>${jsonForHtml(schema)}</script>`;
    },
  );
}

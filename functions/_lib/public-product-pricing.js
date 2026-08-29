import { publicPricingPayload } from "./pricing.js";
import { productIsPublished } from "./product-publication.generated.js";
import { adminClient } from "./supabase.js";

export async function loadPublicProductPricing(env, productSku) {
  if (!productIsPublished(productSku)) return { data: null, error: { code: "product_unpublished" } };
  const sb = adminClient(env);
  const variantsResult = await sb
    .from("product_variants")
    .select("vsku,product_sku,label,gallons,active,stock,track_stock,allow_backorder,market,package_kind,marketing_name,units_per_case,unit_vsku,requires_quote,pricing_source_version,products(name,mode,active),price_tiers(tier,price)")
    .eq("product_sku", productSku)
    .eq("active", true)
    .order("sort", { ascending: true });

  if (variantsResult.error) return { data: null, error: variantsResult.error };
  const variants = (variantsResult.data || []).filter((variant) => (
    variant.products?.active !== false && variant.products?.mode === "buy"
  ));
  const tierCells = variants.flatMap((variant) => (
    (variant.price_tiers || []).map((cell) => ({ ...cell, vsku: variant.vsku }))
  ));
  const pricing = publicPricingPayload({ variants, tierCells });
  const variantBySku = new Map(variants.map((variant) => [variant.vsku, variant]));
  pricing.variants = pricing.variants.map((variant) => {
    const source = variantBySku.get(variant.vsku);
    return {
      ...variant,
      product_mode: source.products.mode,
      stock: source.stock == null ? null : Number(source.stock),
      track_stock: source.track_stock === true,
      allow_backorder: source.allow_backorder === true,
    };
  });
  return { data: pricing, error: null };
}

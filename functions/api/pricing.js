import { adminClient, json } from "../_lib/supabase.js";
import { PUBLIC_PRICE_TIERS, publicPricingPayload } from "../_lib/pricing.js";

export async function onRequestGet({ env }) {
  const sb = adminClient(env);
  const [variantsResult, tiersResult, servicesResult, programsResult] = await Promise.all([
    sb
      .from("product_variants")
      .select("vsku,product_sku,label,gallons,active,products(name)")
      .order("product_sku", { ascending: true })
      .order("sort", { ascending: true }),
    sb
      .from("price_tiers")
      .select("vsku,tier,price")
      .in("tier", PUBLIC_PRICE_TIERS),
    sb
      .from("services")
      .select("sku,name,category,unit,public_price,mode,active")
      .eq("active", true)
      .order("sku", { ascending: true }),
    sb
      .from("content_entries")
      .select("slug,title,payload,status,version")
      .eq("type", "pricing_tier")
      .eq("status", "published"),
  ]);

  const error = variantsResult.error
    || tiersResult.error
    || servicesResult.error
    || programsResult.error;
  if (error) return json(500, { error: "pricing_unavailable" });

  return json(
    200,
    publicPricingPayload({
      variants: variantsResult.data,
      tierCells: tiersResult.data,
      services: servicesResult.data,
      programs: programsResult.data,
    }),
    { "cache-control": "no-store" },
  );
}

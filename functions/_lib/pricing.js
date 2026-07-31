export const PRICE_TIERS = Object.freeze(["retail", "hvac", "wholesale"]);
export const PUBLIC_PRICE_TIERS = Object.freeze(["retail", "hvac"]);

function requiredText(value, code, { lower = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(code);
  return lower ? text.toLowerCase() : text;
}

function money(value, { nullable = false } = {}) {
  if (nullable && (value == null || String(value).trim() === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("price_must_be_numeric");
  if (parsed < 0) throw new Error("price_must_be_non_negative");
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function normalizePricingUpdate(input = {}) {
  const resource = requiredText(input.resource, "pricing_resource_required", { lower: true });

  if (resource === "variant") {
    const vsku = requiredText(input.vsku, "vsku_required").toUpperCase();
    const source = input.tiers && typeof input.tiers === "object" ? input.tiers : {};
    const tiers = {};
    for (const tier of PRICE_TIERS) {
      if (Object.prototype.hasOwnProperty.call(source, tier)) {
        tiers[tier] = money(source[tier], { nullable: true });
      }
    }
    if (!Object.keys(tiers).length) throw new Error("variant_price_required");
    return { resource, vsku, tiers };
  }

  if (resource === "service") {
    return {
      resource,
      sku: requiredText(input.sku, "service_sku_required").toUpperCase(),
      public_price: money(input.public_price, { nullable: true }),
    };
  }

  if (resource === "program") {
    const expectedVersion = Number(input.expected_version);
    const normalized = {
      resource,
      slug: requiredText(input.slug, "program_slug_required", { lower: true }),
      price: requiredText(input.price, "program_price_required"),
      annual: requiredText(input.annual, "program_annual_required"),
    };
    if (Number.isInteger(expectedVersion) && expectedVersion >= 0) {
      normalized.expected_version = expectedVersion;
    }
    return normalized;
  }

  throw new Error("unsupported_pricing_resource");
}

export function publicPricingPayload({
  variants = [],
  tierCells = [],
  services = [],
  programs = [],
} = {}) {
  const tierMap = new Map();
  for (const cell of tierCells) {
    if (!PUBLIC_PRICE_TIERS.includes(cell.tier) || cell.price == null) continue;
    const tiers = tierMap.get(cell.vsku) || {};
    tiers[cell.tier] = Number(cell.price);
    tierMap.set(cell.vsku, tiers);
  }

  return {
    generated_at: new Date().toISOString(),
    currency: "usd",
    variants: variants.map((variant) => ({
      vsku: variant.vsku,
      product_sku: variant.product_sku,
      product_name: variant.products?.name || variant.product_name || variant.product_sku,
      label: variant.label,
      gallons: Number(variant.gallons ?? variant.size_gal ?? 0),
      active: variant.active !== false,
      tiers: { ...tierMap.get(variant.vsku) },
    })),
    services: services
      .filter((service) => service.active !== false)
      .map((service) => ({
        sku: service.sku,
        name: service.name,
        category: service.category,
        unit: service.unit,
        public_price: service.public_price == null ? null : Number(service.public_price),
        mode: service.mode,
      })),
    pricing_tiers: programs
      .filter((program) => program.status === "published" && program.payload?.active !== false)
      .map((program) => ({
        slug: program.slug,
        title: program.title,
        version: Number(program.version || 0),
        ...program.payload,
      }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  };
}

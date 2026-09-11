/* Owner-approved marine aliases layered over canonical VertKleen product/SKU records. */

export const MARINE_CATALOG_GROUP = Object.freeze({ key: "marine", label: "Marine Line" });

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMarineCatalog(payload) {
  const marine = Array.isArray(payload?.industries)
    ? payload.industries.find((entry) => entry?.slug === "marine")
    : null;
  if (marine?.marine_brand_release?.status !== "owner_approved_marketing_names") return [];
  if (!Array.isArray(marine.approved_product_names) || !marine.approved_product_names.length) return [];

  const entries = marine.approved_product_names.map((source) => {
    const id = clean(source?.base_product).toLowerCase();
    const name = clean(source?.name);
    const sku = clean(source?.sku);
    const summary = clean(source?.job_focus);
    const rawImage = clean(source?.image);
    const imagePath = rawImage.replace(/^\/+/, "");
    const localImage = /^img\/products\/[^/]+-marine-studio\.webp$/.test(imagePath);
    const cmsImage = /^https:\/\/media\.masest\.co\/site\/img\/products\/[^/]+-marine-studio\.webp$/.test(rawImage);
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
      || !name
      || !/^VK-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(sku)
      || !summary
      || (!localImage && !cmsImage)
    ) {
      return null;
    }
    return Object.freeze({
      id,
      name,
      sku,
      summary,
      image: cmsImage ? rawImage : `/${imagePath}`,
      href: `/products/${id}?market=marine`,
      market: "marine",
    });
  });

  if (entries.some((entry) => !entry)) return [];
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) return [];
  return entries;
}

export async function loadMarineCatalog(fetchImpl = fetch) {
  for (const url of ["/data/marine-catalog.json?v=20260911c", "/data/industry-applications.json"]) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        cache: "force-cache",
      });
      if (!response.ok) continue;
      const entries = parseMarineCatalog(await response.json());
      if (entries.length) return entries;
    } catch {
      // Try source-tree fallback; production only publishes the sanitized artifact.
    }
  }
  return [];
}

export function marineSearchRow(commerceRow, entry) {
  if (!entry) return commerceRow || null;
  return {
    ...(commerceRow || {}),
    catalog_aliases: [entry.name, entry.sku],
    catalog_job_focus: entry.summary,
  };
}

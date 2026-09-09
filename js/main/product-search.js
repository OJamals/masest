import { CATALOG_GROUPS, PRODUCT_CATALOG_COPY, PRODUCTS } from "./catalog-data.js?v=20260909b";
import { normalizeSearchText, searchValueTokenQuality } from "./fuzzy-search.js?v=20260909b";

export const normalizeProductSearch = normalizeSearchText;

function productSearchGroups(id, commerceRow) {
  const product = PRODUCTS[id];
  if (!product) return [];
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const group = CATALOG_GROUPS.find((entry) => entry.ids.includes(id));
  const variants = [
    ...(commerceRow?.variants || []),
    ...(commerceRow?.caseVariants || []),
    ...(commerceRow?.quoteVariants || []),
  ];
  const productName = String(product.name || "");

  return [
    {
      exact: 1500,
      token: 120,
      values: [
        id,
        productName,
        productName.replace(/^VertKleen\s+/i, ""),
        commerceRow?.sku,
        ...(commerceRow?.catalog_aliases || []),
        ...variants.flatMap((variant) => [variant?.vsku, variant?.marketing_name]),
      ],
    },
    {
      exact: 700,
      token: 70,
      values: [
        product.replaces,
        group?.label,
        copy.job,
        copy.platform,
        commerceRow?.catalog_job_focus,
        ...variants.map((variant) => variant?.label),
      ],
    },
    {
      exact: 300,
      token: 30,
      values: [
        product.uses,
        (product.docs || []).map((doc) => typeof doc === "string" ? doc : doc?.label),
        copy.summary,
        copy.mechanism,
        copy.operator_advantage,
        copy.fits,
        copy.proof,
      ].flat(),
    },
  ].map((groupEntry, groupIndex) => {
    const values = groupEntry.values.filter(Boolean).map(normalizeProductSearch).filter(Boolean);
    if (groupIndex === 0) {
      values.push(...values.filter((value) => value.includes(" ")).map((value) => value.replace(/\s/g, "")));
    }
    return { ...groupEntry, values: [...new Set(values)] };
  });
}

export function productSearchScore(id, query, commerceRow) {
  const normalizedQuery = normalizeProductSearch(query);
  if (!normalizedQuery) return 0;
  if (!PRODUCTS[id]) return -1;
  const groups = productSearchGroups(id, commerceRow);
  const tokens = normalizedQuery.split(" ");
  let tokenScore = 0;

  for (const token of tokens) {
    const bestMatch = groups.reduce((best, group) => {
      const quality = group.values.reduce(
        (bestQuality, value) => Math.max(bestQuality, searchValueTokenQuality(value, token)),
        0,
      );
      return Math.max(best, Math.round(group.token * quality / 100));
    }, 0);
    if (!bestMatch) return -1;
    tokenScore += bestMatch;
  }

  const exactScore = groups.reduce((best, group) => (
    group.values.includes(normalizedQuery) ? Math.max(best, group.exact) : best
  ), 0);
  return exactScore + tokenScore;
}

export function rankProductIds(ids, query, rowLookup = () => null) {
  const normalizedQuery = normalizeProductSearch(query);
  if (!normalizedQuery) return [...ids];
  return ids
    .map((id, index) => ({ id, index, score: productSearchScore(id, normalizedQuery, rowLookup(id)) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id }) => id);
}

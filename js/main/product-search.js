import { CATALOG_GROUPS, PRODUCT_CATALOG_COPY, PRODUCTS } from "./catalog-data.js?v=20260829b";

export function normalizeProductSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PRODUCT_SEARCH_FUZZY_MIN_LENGTH = 4;
const PRODUCT_SEARCH_FUZZY_MAX_LENGTH = 32;

function fuzzyEditLimit(left, right) {
  const shortest = Math.min(left.length, right.length);
  const longest = Math.max(left.length, right.length);
  if (shortest < PRODUCT_SEARCH_FUZZY_MIN_LENGTH || longest > PRODUCT_SEARCH_FUZZY_MAX_LENGTH) return 0;
  return longest >= 8 ? 2 : 1;
}

function boundedDamerauLevenshtein(left, right, maxDistance) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previousPrevious = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let distance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      if (
        previousPrevious
        && leftIndex > 1
        && rightIndex > 1
        && left[leftIndex - 1] === right[rightIndex - 2]
        && left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = distance;
    }
    previousPrevious = previous;
    previous = current;
  }

  return previous[right.length];
}

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

function searchValueTokenQuality(value, token) {
  let best = 0;
  for (const word of value.split(" ")) {
    if (word === token) return 100;
    if (token.length >= 3 && word.startsWith(token)) best = Math.max(best, 90);

    const maxDistance = fuzzyEditLimit(token, word);
    if (!maxDistance) continue;
    const distance = boundedDamerauLevenshtein(token, word, maxDistance);
    if (distance === 1) best = Math.max(best, 72);
    if (distance === 2 && maxDistance === 2) best = Math.max(best, 54);
  }
  return best;
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

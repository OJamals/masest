const SEARCH_FUZZY_MIN_LENGTH = 4;
const SEARCH_FUZZY_MAX_LENGTH = 32;

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function fuzzyEditLimit(left, right) {
  const shortest = Math.min(left.length, right.length);
  const longest = Math.max(left.length, right.length);
  if (shortest < SEARCH_FUZZY_MIN_LENGTH || longest > SEARCH_FUZZY_MAX_LENGTH) return 0;
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

export function searchValueTokenQuality(value, token) {
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

export function searchTextMatchesQuery(value, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const normalizedValue = normalizeSearchText(value);
  if (normalizedValue.includes(normalizedQuery)) return true;
  return normalizedQuery
    .split(" ")
    .every((token) => searchValueTokenQuality(normalizedValue, token) > 0);
}

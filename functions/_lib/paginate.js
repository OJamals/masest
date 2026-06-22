// Offset/limit pagination for list endpoints (#29).
// Pairs with Supabase `.range(offset, offset + limit - 1)` + `{ count: 'exact' }`.

// Parse `?limit` / `?offset` from a URLSearchParams, clamped to safe bounds.
// Junk / zero / negative values fall back to the defaults.
export function parsePage(searchParams, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const rawLimit = parseInt(searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

// Build the standard pagination envelope to spread into a list response.
// `count` is the exact total from `{ count: 'exact' }` (null when unavailable —
// then has_more falls back to "this page came back full".
export function pageEnvelope(items, { limit, offset, count }) {
  const list = items || [];
  const total = typeof count === 'number' ? count : null;
  const has_more = total != null ? offset + list.length < total : list.length >= limit;
  return { total, limit, offset, has_more };
}

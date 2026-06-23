// Best-effort read-through cache backed by Cloudflare KV.
// SAFE TO SHIP BEFORE A BINDING EXISTS: with no KV namespace, every call computes
// live (current behaviour). Piggybacks the already-bound RATE_KV namespace so it
// needs no new owner setup; keys are prefixed (cache:...) to avoid colliding with
// rate-limit keys. Mirrors the dormant-safe pattern in _lib/ratelimit.js.
//
// Cached payloads are org-wide (no per-user data) and the caller MUST authorize the
// request BEFORE calling cached() — auth never depends on the cached value.
export async function cached(env, key, ttlSec, compute) {
  const kv = env && env.RATE_KV;
  if (!kv) return compute();
  try {
    const hit = await kv.get(key);
    if (hit != null) return JSON.parse(hit);
  } catch {
    return compute(); // KV unreachable -> serve live, skip the write
  }
  const value = await compute();
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  } catch {
    /* best-effort: a failed write just means the next request recomputes */
  }
  return value;
}

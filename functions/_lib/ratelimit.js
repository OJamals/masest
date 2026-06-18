// Lightweight per-IP fixed-window rate limit backed by a Cloudflare KV namespace.
//
// SAFE TO SHIP BEFORE THE BINDING EXISTS: if no KV namespace named RATE_KV is
// bound to the Pages project, rateLimit() always allows (returns { ok: true,
// disabled: true }). To enable, create a KV namespace in the Cloudflare
// dashboard and bind it as RATE_KV under the masest-commerce Pages project.
//
// Fixed-window (not sliding): the window key includes floor(now / windowSec),
// so a burst is counted within its window and the counter expires via TTL.
export async function rateLimit(env, bucket, ip, { limit = 10, windowSec = 60 } = {}) {
  const kv = env && env.RATE_KV;
  if (!kv || !ip) return { ok: true, disabled: true };
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${ip}:${win}`;
  let count = 0;
  try { count = Number(await kv.get(key)) || 0; } catch { return { ok: true }; }
  if (count >= limit) return { ok: false, retryAfter: windowSec };
  try { await kv.put(key, String(count + 1), { expirationTtl: windowSec * 2 }); } catch { /* best-effort */ }
  return { ok: true };
}

// Cloudflare provides the real client IP via CF-Connecting-IP; fall back to XFF.
export const clientIp = (request) =>
  request.headers.get('CF-Connecting-IP') ||
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  '';

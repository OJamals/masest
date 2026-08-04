const JWKS_URL = 'https://api.shipengine.com/jwks';
const DEFAULT_TOLERANCE_SECONDS = 300;
const cachedKeys = new Map();

function base64Bytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function timestampMillis(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function publicKey(kid, request = fetch) {
  if (cachedKeys.has(kid)) return cachedKeys.get(kid);
  const response = await request(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const jwk = (Array.isArray(body?.keys) ? body.keys : []).find((entry) => entry?.kid === kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  cachedKeys.set(kid, key);
  return key;
}

export async function verifyShipStationSignature(headers, rawBody, options = {}) {
  const kid = headers.get('x-shipengine-rsa-sha256-key-id');
  const signature = headers.get('x-shipengine-rsa-sha256-signature');
  const timestamp = headers.get('x-shipengine-timestamp');
  if (!kid || !signature || !timestamp) return false;
  const nowMs = Number(options.nowMs ?? Date.now());
  const toleranceSeconds = Number(options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS);
  const signedAt = timestampMillis(timestamp);
  if (!Number.isFinite(signedAt) || Math.abs(nowMs - signedAt) > toleranceSeconds * 1000) return false;
  try {
    const key = await publicKey(kid, options.fetch || fetch);
    if (!key) return false;
    return crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      base64Bytes(signature),
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    );
  } catch {
    return false;
  }
}

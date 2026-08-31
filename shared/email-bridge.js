const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timingSafeHexEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length
    || a.length < 2
    || a.length > 128
    || a.length % 2 !== 0
    || !/^[a-f0-9]+$/.test(a)
    || !/^[a-f0-9]+$/.test(b)) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export async function signEmailBridgePayload(secret, timestamp, rawBody) {
  const value = String(secret || '');
  if (!value) throw new Error('email_bridge_secret_required');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return bytesToHex(signature);
}

export async function verifyEmailBridgePayload({
  secret,
  timestamp,
  rawBody,
  signature,
  nowMs = Date.now(),
  maxAgeSeconds = 300,
}) {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isInteger(parsedTimestamp)) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - parsedTimestamp) > maxAgeSeconds) return false;
  let expected;
  try {
    expected = await signEmailBridgePayload(secret, parsedTimestamp, rawBody);
  } catch {
    return false;
  }
  return timingSafeHexEqual(expected, signature);
}

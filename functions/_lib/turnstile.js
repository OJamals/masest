const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile({ secret, token, remoteip = '', fetchImpl = fetch }) {
  if (!secret) return { status: 'unconfigured' };
  if (!String(token || '').trim()) return { status: 'rejected' };

  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: String(secret),
        response: String(token),
        remoteip: String(remoteip || ''),
      }),
    });
    if (!response.ok) return { status: 'unavailable' };
    const result = await response.json();
    return { status: result?.success === true ? 'verified' : 'rejected' };
  } catch {
    return { status: 'unavailable' };
  }
}

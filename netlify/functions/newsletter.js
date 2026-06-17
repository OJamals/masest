// POST /api/newsletter — subscribe an email to the Klaviyo newsletter list.
// Private key is server-side only. Double opt-in is governed by the list's Klaviyo settings.
import { json, readBody } from '../lib/supabase.js';

const REVISION = '2024-10-15';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const body = await readBody(req);
  const email = String(body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'invalid_email' });
  if (body.company) return json(200, { ok: true }); // honeypot — silently accept, do nothing

  const key = process.env.KLAVIYO_PRIVATE_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;
  if (!key || !listId) return json(500, { error: 'newsletter_not_configured' });

  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: {
              email,
              subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
            },
          }],
        },
      },
      relationships: { list: { data: { type: 'list', id: listId } } },
    },
  };

  const resp = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: REVISION,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (resp.status !== 202) {
    const detail = await resp.text().catch(() => '');
    return json(502, { error: 'klaviyo_error', status: resp.status, detail: detail.slice(0, 300) });
  }
  return json(200, { ok: true });
};

export const config = { path: '/api/newsletter' };

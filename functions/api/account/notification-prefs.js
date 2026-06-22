// /api/account/notification-prefs — per-user email opt-in/out (#19).
//   GET            → { notify_orders, notify_offers, notify_messages }
//   PATCH { ... }  → update the caller's own flags (booleans only)
import { requireCompany, json, readBody, sanitizeNotificationPrefs } from '../../_lib/supabase.js';

const COLUMNS = 'notify_orders,notify_offers,notify_messages';
const DEFAULTS = { notify_orders: true, notify_offers: true, notify_messages: true };

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, sb } = ctx;
  const { data } = await sb.from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  return json(200, { ...DEFAULTS, ...(data || {}) });
}

export async function onRequestPatch({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, sb } = ctx;
  const patch = sanitizeNotificationPrefs(await readBody(request));
  if (!Object.keys(patch).length) return json(400, { error: 'no_valid_fields' });
  const { data, error } = await sb.from('profiles').update(patch).eq('id', user.id).select(COLUMNS).maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ...DEFAULTS, ...(data || {}) });
}

// /api/admin/message-settings — per-staff opt-in for support inbox email alerts.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { ADMIN_MESSAGE_PREF_COLUMNS, sanitizeAdminMessagePrefs } from '../../_lib/admin-message-notifications.js';

const COLUMNS = ADMIN_MESSAGE_PREF_COLUMNS.join(',');
const DEFAULTS = Object.fromEntries(ADMIN_MESSAGE_PREF_COLUMNS.map((column) => [column, false]));

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const { data } = await adminClient(env).from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  return json(200, { ...DEFAULTS, ...(data || {}) });
}

export async function onRequestPatch({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const patch = sanitizeAdminMessagePrefs(await readBody(request));
  if (!Object.keys(patch).length) return json(400, { error: 'no_valid_fields' });
  const sb = adminClient(env);
  const { data, error } = await sb.from('profiles').update(patch).eq('id', user.id).select(COLUMNS).maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ...DEFAULTS, ...(data || {}) });
}

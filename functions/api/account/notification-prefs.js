// /api/account/notification-prefs — authenticated user's email controls.
// Transactional service mail is mandatory. Marketing defaults on and may be disabled.
import {
  adminClient,
  json,
  loadSuppressed,
  readBody,
  sanitizeNotificationPrefs,
  userFromRequest,
} from '../../_lib/supabase.js';
import { setMarketingPreference } from '../../_lib/marketing-subscribers.js';

const COLUMNS = 'marketing_email_enabled,notify_messages';
const DEFAULTS = { marketing_email_enabled: true, notify_messages: true };

async function responsePrefs(env, user, row = {}, marketingSync = 'synced') {
  const suppression = await loadSuppressed(env, [user.email]);
  const blocked = suppression.get(String(user.email || '').toLowerCase())?.has('marketing') === true;
  return {
    transactional_email_enabled: true,
    transactional_email_required: true,
    marketing_email_enabled: row.marketing_email_enabled !== false && !blocked,
    notify_messages: row.notify_messages !== false,
    marketing_sync: marketingSync,
  };
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const sb = adminClient(env);
  const { data, error } = await sb.from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  if (error) return json(503, { error: 'email_preferences_unavailable', retryable: true });
  return json(200, await responsePrefs(env, user, { ...DEFAULTS, ...(data || {}) }));
}

export async function onRequestPatch({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const sb = adminClient(env);
  const body = await readBody(request);
  if (body.transactional_email_enabled === false) {
    return json(400, { error: 'transactional_email_required' });
  }
  const patch = sanitizeNotificationPrefs(body);
  if (!Object.keys(patch).length) return json(400, { error: 'no_valid_fields' });

  if (typeof patch.marketing_email_enabled === 'boolean') {
    const result = await setMarketingPreference(env, {
      email: user.email,
      enabled: patch.marketing_email_enabled,
      source: 'account_email_preferences',
      userId: user.id,
    }, { sb });
    if (!result.ok) return json(503, { error: result.error, retryable: result.retryable });
  }

  const nonMarketingPatch = { ...patch };
  delete nonMarketingPatch.marketing_email_enabled;
  if (Object.keys(nonMarketingPatch).length) {
    const { error } = await sb.from('profiles').update(nonMarketingPatch).eq('id', user.id);
    if (error) return json(500, { error: 'server_error' });
  }
  const { data, error } = await sb.from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  if (error) return json(503, { error: 'email_preferences_unavailable', retryable: true });
  return json(200, await responsePrefs(env, user, { ...DEFAULTS, ...(data || {}) }, 'synced'));
}

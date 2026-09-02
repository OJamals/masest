// /api/account/notification-prefs — authenticated user's email controls.
// Transactional service mail is mandatory. Marketing defaults on and may be disabled.
import {
  adminClient,
  clearSuppression,
  json,
  loadSuppressed,
  readBody,
  recordSuppression,
  sanitizeNotificationPrefs,
  userFromRequest,
} from '../../_lib/supabase.js';
import { klaviyoSubscribe, klaviyoUnsubscribe } from '../../_lib/klaviyo.js';

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

  let marketingSync = 'synced';
  if (patch.marketing_email_enabled === true) {
    const subscribed = await klaviyoSubscribe(env, user.email, env.KLAVIYO_LIST_ID, {
      source: 'account_email_preferences',
    });
    if (!subscribed.ok) {
      return json(502, { error: 'marketing_subscribe_failed', retryable: true });
    }
  }

  const { data, error } = await sb.from('profiles').update(patch).eq('id', user.id).select(COLUMNS).maybeSingle();
  if (error) {
    if (patch.marketing_email_enabled === true) {
      await klaviyoUnsubscribe(env, user.email, env.KLAVIYO_LIST_ID);
    }
    return json(500, { error: 'server_error' });
  }

  if (patch.marketing_email_enabled === false) {
    await recordSuppression(env, user.email, 'user_preference', 'marketing');
    const unsubscribed = await klaviyoUnsubscribe(env, user.email, env.KLAVIYO_LIST_ID);
    if (!unsubscribed.ok) marketingSync = 'pending';
  } else if (patch.marketing_email_enabled === true) {
    const cleared = await clearSuppression(env, user.email, 'marketing');
    if (!cleared) marketingSync = 'pending';
  }

  return json(200, await responsePrefs(env, user, { ...DEFAULTS, ...(data || {}) }, marketingSync));
}

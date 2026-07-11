import { emailsByIds } from './supabase.js';
import { isStaffEmail } from './authz.js';
import { presenceIsFresh } from './support-messages.js';

const PREF_COLUMNS = {
  support_request: 'notify_admin_support_requests',
  message: 'notify_admin_messages',
};

export function adminMessageAlertKind({ previousMessage, threadStatus }) {
  if (!previousMessage || threadStatus === 'complete') return 'support_request';
  return 'message';
}

export function sanitizeAdminMessagePrefs(body) {
  const out = {};
  for (const column of Object.values(PREF_COLUMNS)) {
    if (typeof body?.[column] === 'boolean') out[column] = body[column];
  }
  return out;
}

export async function adminMessageRecipients(sb, kind, env, now = Date.now()) {
  const column = PREF_COLUMNS[kind];
  if (!column) return [];
  const { data, error } = await sb.from('profiles').select('id,is_staff,support_inbox_seen_at').eq(column, true);
  if (error || !data?.length) return [];
  const emails = await emailsByIds(sb, data.map((profile) => profile.id));
  const recipients = data.flatMap((profile) => {
    const email = emails[profile.id];
    const currentlyStaff = profile.is_staff === true || isStaffEmail(email, env);
    const inboxOpen = kind === 'message' && presenceIsFresh(profile.support_inbox_seen_at, now);
    return email && currentlyStaff && !inboxOpen ? [email] : [];
  });
  return [...new Set(recipients)];
}

export const ADMIN_MESSAGE_PREF_COLUMNS = Object.values(PREF_COLUMNS);

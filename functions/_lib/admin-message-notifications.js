import { emailsByIds } from './supabase.js';

const PREF_COLUMNS = {
  support_request: 'notify_admin_support_requests',
  message: 'notify_admin_messages',
};

export function adminMessageAlertKind({ previousMessage, threadStatus, chatOpen }) {
  if (!previousMessage || threadStatus === 'complete') return 'support_request';
  return chatOpen === true ? null : 'message';
}

export function sanitizeAdminMessagePrefs(body) {
  const out = {};
  for (const column of Object.values(PREF_COLUMNS)) {
    if (typeof body?.[column] === 'boolean') out[column] = body[column];
  }
  return out;
}

export async function adminMessageRecipients(sb, kind) {
  const column = PREF_COLUMNS[kind];
  if (!column) return [];
  const { data, error } = await sb.from('profiles').select('id').eq(column, true);
  if (error || !data?.length) return [];
  const emails = await emailsByIds(sb, data.map((profile) => profile.id));
  return [...new Set([...emails.values()])];
}

export const ADMIN_MESSAGE_PREF_COLUMNS = Object.values(PREF_COLUMNS);

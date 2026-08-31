// Message email policy: every staff message can target its selected buyer.
// A fresh live-chat heartbeat suppresses the redundant email; explicit buyer
// notification preferences remain authoritative.
import { presenceIsFresh } from './support-messages.js';

export function shouldEmailSupportRecipient(profile, email, now = Date.now()) {
  const hasHeartbeat = Object.prototype.hasOwnProperty.call(profile || {}, 'support_chat_seen_at');
  const chatOpen = profile?.support_chat_open === true
    && (!hasHeartbeat || presenceIsFresh(profile.support_chat_seen_at, now));
  return Boolean(
    email
    && profile?.notify_messages !== false
    && !chatOpen,
  );
}

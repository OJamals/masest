// Message email policy: live chat remains in-app; email only catches a buyer
// after their unanswered question and after they have closed the chat.
import { presenceIsFresh } from './support-messages.js';

export function shouldEmailClosedChatReply(lastMessage, profile, email, now = Date.now()) {
  const hasHeartbeat = Object.prototype.hasOwnProperty.call(profile || {}, 'support_chat_seen_at');
  const chatOpen = profile?.support_chat_open === true
    && (!hasHeartbeat || presenceIsFresh(profile.support_chat_seen_at, now));
  return Boolean(
    email
    && lastMessage?.sender_role === 'buyer'
    && lastMessage?.user_id
    && profile?.notify_messages !== false
    && !chatOpen,
  );
}

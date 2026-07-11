// Message email policy: live chat remains in-app; email only catches a buyer
// after their unanswered question and after they have closed the chat.
export function shouldEmailClosedChatReply(lastMessage, profile, email) {
  return Boolean(
    email
    && lastMessage?.sender_role === 'buyer'
    && lastMessage?.user_id
    && profile?.notify_messages !== false
    && profile?.support_chat_open !== true,
  );
}

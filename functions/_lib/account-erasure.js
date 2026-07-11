export async function deleteAccountUser(sb, userId) {
  const { data: ready, error: readinessError } = await sb.rpc('account_erasure_ready');
  if (readinessError || ready !== true) {
    return { ok: false, code: 'account_erasure_not_ready' };
  }

  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return { ok: false, code: 'delete_failed' };
  return { ok: true };
}

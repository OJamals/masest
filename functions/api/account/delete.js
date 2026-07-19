// POST /api/account/delete — GDPR erasure of the caller. Auth deletion atomically
// pseudonymizes retained orders through the account-erasure database trigger. Financial
// records and the shared company remain. Irreversible — requires { confirm:'DELETE' }.
import { deleteAccountUser } from '../../_lib/account-erasure.js';
import { isLastAdmin } from '../../_lib/members.js';
import { adminClient, json, readBody, userFromRequest } from '../../_lib/supabase.js';

export async function companyAdminErasureGuard(sb, userId) {
  let profileResult;
  try {
    profileResult = await sb.from('profiles')
      .select('company_id,role').eq('id', userId).maybeSingle();
  } catch {
    return json(500, { error: 'server_error' });
  }
  if (profileResult.error) return json(500, { error: 'server_error' });

  const profile = profileResult.data;
  if (profile?.company_id && profile.role === 'admin') {
    let memberResult;
    try {
      memberResult = await sb.from('profiles').select('id,role')
        .eq('company_id', profile.company_id);
    } catch {
      return json(500, { error: 'server_error' });
    }
    if (memberResult.error) return json(500, { error: 'server_error' });

    if (isLastAdmin(memberResult.data, userId)) return json(409, {
      error: 'last_company_admin',
      message: 'Transfer ownership through Team settings before deleting your account.',
    });
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const { confirm } = await readBody(request);
  if (confirm !== 'DELETE') return json(400, { error: 'confirmation_required' });

  const sb = adminClient(env);
  const guardResponse = await companyAdminErasureGuard(sb, user.id);
  if (guardResponse) return guardResponse;

  const result = await deleteAccountUser(sb, user.id);
  if (!result.ok && result.code === 'account_erasure_not_ready') return json(503, {
    error: 'account_erasure_not_ready',
    message: 'Account deletion is temporarily unavailable. Retry later.',
  });
  if (!result.ok) return json(500, {
    error: 'delete_failed',
    message: 'Could not delete the account. Retry.',
  });

  return json(200, { deleted: true });
}

// POST /api/account/delete — GDPR erasure of the caller. Pseudonymizes + detaches the caller's
// PII from retained financial records (orders), then deletes their Supabase auth login, which
// cascade-removes their profile and notifications (messages/invites auto-null). Financial records
// (orders/quotes) are kept for tax/accounting retention; the shared company is left intact for
// other members. Irreversible — requires an explicit { confirm:'DELETE' } body.
import { requireCompany, json, readBody } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, sb } = ctx;

  const { confirm } = await readBody(request);
  if (confirm !== 'DELETE') return json(400, { error: 'confirmation_required' });

  // orders.user_id has no cascade/set-null FK action, so it would block the profile delete —
  // null it (and pseudonymize the email) before removing the login.
  const anon = `anon-${user.id}@deleted.invalid`;
  await sb.from('orders').update({ user_id: null, customer_email: anon }).eq('user_id', user.id);

  // Deleting the auth user cascade-deletes profiles(id)→auth.users and notifications.user_id.
  const { error } = await sb.auth.admin.deleteUser(user.id);
  if (error) return json(500, { error: 'delete_failed', detail: error.message });

  return json(200, { deleted: true });
}

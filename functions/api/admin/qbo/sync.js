// POST /api/admin/qbo/sync - staff-triggered QBO sync.
import { json, requireStaff } from '../../../_lib/supabase.js';
import { runQboSync } from '../../qbo-sync.js';

export async function onRequestPost({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  return runQboSync({ env });
}

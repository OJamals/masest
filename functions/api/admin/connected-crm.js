import { json, requireStaff } from '../../_lib/supabase.js';
import { createConnectedStaffDirectory } from '../../_lib/connected-staff-directory.js';
import { connectedCrmConfigured, handleConnectedCrm } from '../../_lib/connected-crm.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!connectedCrmConfigured(env)) return json(503, { error: { code: 'crm_not_configured', message: 'MASEST CRM intake is not connected yet.' } });
  let identity;
  try { identity = await requireStaff(request, env); }
  catch { return json(503, { error: { code: 'identity_unavailable', message: 'Staff authorization is unavailable' } }); }
  const { user, staff } = identity;
  if (!user) return json(401, { error: { code: 'unauthenticated', message: 'Sign in to MASEST Admin' } });
  if (!staff) return json(403, { error: { code: 'forbidden', message: 'Platform staff access required' } });
  // Reuse this request's fresh identity; the bridge additionally validates role,
  // origin, request bounds and route scope before signing anything.
  return handleConnectedCrm(context, { requireStaff: async () => identity,
    staffDirectory: createConnectedStaffDirectory(env, { signal: request.signal }) });
}

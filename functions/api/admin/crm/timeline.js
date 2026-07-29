// /api/admin/crm/timeline — virtual, read-time merge of a contact's activity.
// Queries existing per-company signals + crm_notes/crm_tasks; never instruments
// write paths. The relationship activity module owns retrieval and merging.
import { adminClient, json, requireStaff } from '../../../_lib/supabase.js';
import { createCrmActivityModule, createSupabaseCrmActivityStore } from '../../../_lib/crm-activity.js';

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(request.url);
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');

  const sb = adminClient(env);
  const activity = createCrmActivityModule({
    store: createSupabaseCrmActivityStore({ sb }),
  });
  const result = await activity.timeline({ subjectType, subjectId });
  if (!result.ok) return json(400, { error: result.error });
  return json(200, { timeline: result.timeline });
}

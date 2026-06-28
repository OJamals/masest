// /api/admin/crm/notes — staff CRM notes on a company or quote (slice 1).
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { noteRow, validSubject } from '../../../_lib/crm.js';

const SELECT = 'id,subject_type,subject_id,kind,body,created_by,created_at';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const subjectType = url.searchParams.get('subject_type');
    const subjectId = url.searchParams.get('subject_id');
    if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });
    const { data, error } = await sb.from('crm_notes').select(SELECT)
      .eq('subject_type', subjectType).eq('subject_id', String(subjectId))
      .is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { notes: [], needs_migration: true, viewer: { email: user.email || null, can_delete_any: role === 'owner' } });
      return json(500, { error: error.message });
    }
    return json(200, { notes: data || [], viewer: { email: user.email || null, can_delete_any: role === 'owner' } });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const built = noteRow({ ...body, actor: user.email || null });
    if (built.error) return json(400, { error: built.error });
    const { data, error } = await sb.from('crm_notes').insert(built.row).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.note_add', targetType: built.row.subject_type, targetId: built.row.subject_id, detail: { kind: built.row.kind } });
    return json(200, { ok: true, note: data });
  }

  if (request.method === 'DELETE') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const id = url.searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { data: note, error: getErr } = await sb.from('crm_notes').select('id,created_by').eq('id', id).maybeSingle();
    if (getErr) return json(500, { error: getErr.message });
    if (!note) return json(404, { error: 'not_found' });
    const isOwner = role === 'owner';
    if (!isOwner && note.created_by !== (user.email || null)) return json(403, { error: 'not_author' });
    const { error } = await sb.from('crm_notes').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.note_delete', targetType: 'note', targetId: String(id) });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}

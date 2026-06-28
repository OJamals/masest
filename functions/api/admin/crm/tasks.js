// /api/admin/crm/tasks — staff CRM follow-up tasks on a company or quote (slice 1).
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { taskRow, taskPatch, validSubject } from '../../../_lib/crm.js';

const SELECT = 'id,subject_type,subject_id,title,due_at,assigned_to,status,created_by,created_at,completed_at,completed_by';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const scope = url.searchParams.get('scope');
    let query = sb.from('crm_tasks').select(SELECT);
    if (scope === 'mine') query = query.eq('assigned_to', user.email || '').eq('status', 'open');
    else if (scope === 'overdue') query = query.eq('status', 'open').not('due_at', 'is', null).lte('due_at', new Date().toISOString());
    else if (scope === 'open') query = query.eq('status', 'open');
    else {
      const subjectType = url.searchParams.get('subject_type');
      const subjectId = url.searchParams.get('subject_id');
      if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });
      query = query.eq('subject_type', subjectType).eq('subject_id', String(subjectId));
    }
    const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { tasks: [], needs_migration: true });
      return json(500, { error: error.message });
    }
    const tasks = data || [];
    if (['mine', 'overdue', 'open'].includes(scope) && tasks.length) {
      const ids = { company: new Set(), quote: new Set(), contact: new Set() };
      for (const t of tasks) if (ids[t.subject_type]) ids[t.subject_type].add(t.subject_id);
      const labels = { company: new Map(), quote: new Map(), contact: new Map() };
      if (ids.company.size) {
        const { data: rows, error: e } = await sb.from('companies').select('id,name').in('id', [...ids.company]);
        if (!e) for (const r of rows || []) labels.company.set(String(r.id), r.name);
      }
      if (ids.quote.size) {
        const { data: rows, error: e } = await sb.from('quotes').select('id,company,name,email').in('id', [...ids.quote]);
        if (!e) for (const r of rows || []) labels.quote.set(String(r.id), r.company || r.name || r.email || `Quote ${r.id}`);
      }
      if (ids.contact.size) {
        const { data: rows, error: e } = await sb.from('crm_contacts').select('id,name').in('id', [...[...ids.contact].map(Number)]);
        if (!e) for (const r of rows || []) labels.contact.set(String(r.id), r.name);
      }
      for (const t of tasks) t.subject_label = labels[t.subject_type]?.get(String(t.subject_id)) || null;
    }
    return json(200, { tasks });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const built = taskRow({ ...body, actor: user.email || null });
    if (built.error) return json(400, { error: built.error });
    const { data, error } = await sb.from('crm_tasks').insert(built.row).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.task_add', targetType: built.row.subject_type, targetId: built.row.subject_id, detail: { title: built.row.title } });
    return json(200, { ok: true, task: data });
  }

  if (request.method === 'PATCH') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'id_required' });
    const result = taskPatch({ action: body.action, assigned_to: body.assigned_to, actor: user.email || null }, new Date());
    if (result.error) return json(400, { error: result.error });
    const { data, error } = await sb.from('crm_tasks').update(result.patch).eq('id', body.id).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.task_update', targetType: 'task', targetId: String(body.id), detail: { action: body.action } });
    return json(200, { ok: true, task: data });
  }

  return json(405, { error: 'method_not_allowed' });
}

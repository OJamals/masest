// /api/admin/crm/contacts — staff CRM contact records on a company (slice 4).
// Multiple named contacts per account with role/title/email/phone + one primary.
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import {
  contactRow,
  contactPatch,
  createCrmContactModule,
  createSupabaseCrmContactStore,
  CONTACT_ROLES,
} from '../../../_lib/crm-contacts.js';
import { parsePage, pageEnvelope } from '../../../_lib/paginate.js';

const SELECT = 'id,company_id,name,role,title,email,phone,is_primary,notes,created_by,created_at,updated_at';

function mutationResponse(result) {
  if (result.ok || result.needs_migration) return json(200, result);
  if (result.error === 'duplicate_email') {
    return json(409, { error: result.error, message: result.message });
  }
  if (['company_required', 'no_rows', 'invalid_merge', 'different_company'].includes(result.error)) {
    return json(400, { error: result.error });
  }
  if (result.error === 'not_found') return json(404, { error: result.error });
  return json(500, { error: result.message || result.error });
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const companyId = url.searchParams.get('company_id');
    const q = String(url.searchParams.get('q') || '').trim();

    // Cross-company directory search (no company_id): match name/email/phone, optional role filter.
    if (!companyId) {
      const role = String(url.searchParams.get('role') || '').trim();
      const hasRole = CONTACT_ROLES.includes(role);
      if (q.length < 2 && !hasRole) return json(400, { error: 'query_too_short' });
      const { limit, offset } = parsePage(url.searchParams, { defaultLimit: 50, maxLimit: 100 });
      // Build query incrementally so role-only searches skip the .or() filter.
      let query = sb.from('crm_contacts').select(SELECT, { count: 'exact' }).is('deleted_at', null);
      if (q.length >= 2) {
        // Strip chars that break PostgREST .or() grammar (comma = condition separator, parens = grouping).
        const like = `%${q.replace(/[(),]/g, ' ')}%`;
        query = query.or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
      }
      if (hasRole) query = query.eq('role', role);
      const { data, error, count } = await query.order('name', { ascending: true }).range(offset, offset + limit - 1);
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { contacts: [], needs_migration: true });
        return json(500, { error: error.message });
      }
      const rows = data || [];
      // Resolve company names in one batched lookup.
      const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
      const names = new Map();
      if (companyIds.length) {
        const { data: cos } = await sb.from('companies').select('id,name').in('id', companyIds);
        for (const c of cos || []) names.set(String(c.id), c.name);
      }
      for (const r of rows) r.company_name = names.get(String(r.company_id)) || null;
      return json(200, { contacts: rows, ...pageEnvelope(rows, { limit, offset, count }) });
    }

    // Company-scoped list (existing behavior — unchanged).
    if (!String(companyId).trim()) return json(400, { error: 'company_required' });
    const { data, error } = await sb.from('crm_contacts').select(SELECT)
      .eq('company_id', String(companyId)).is('deleted_at', null)
      .order('is_primary', { ascending: false }).order('name', { ascending: true }).limit(200);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { contacts: [], needs_migration: true });
      return json(500, { error: error.message });
    }
    return json(200, { contacts: data || [] });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const contacts = createCrmContactModule({
      store: createSupabaseCrmContactStore(sb),
      audit: (entry) => recordAudit(sb, { user, ...entry }),
    });

    if (body.action === 'import') {
      return mutationResponse(await contacts.importCsv({
        companyId: body.company_id,
        csv: body.csv,
        actor: user.email || null,
      }));
    }

    if (body.action === 'merge') {
      return mutationResponse(await contacts.merge({
        fromId: body.from_id,
        intoId: body.into_id,
      }));
    }

    if (body.id) {
      const built = contactPatch(body, new Date());
      if (built.error) return json(400, { error: built.error });
      const { data: existing, error: getErr } = await sb.from('crm_contacts')
        .select('id,company_id').eq('id', body.id).is('deleted_at', null).maybeSingle();
      if (getErr) return json(500, { error: getErr.message });
      if (!existing) return json(404, { error: 'not_found' });
      if (built.patch.is_primary === true) {
        await sb.from('crm_contacts').update({ is_primary: false }).eq('company_id', existing.company_id).neq('id', existing.id);
      }
      const { data, error } = await sb.from('crm_contacts').update(built.patch).eq('id', existing.id).select(SELECT).single();
      if (error) return json(500, { error: error.message });
      await recordAudit(sb, { user, action: 'crm.contact_update', targetType: 'company', targetId: existing.company_id, detail: { contact: existing.id } });
      return json(200, { ok: true, contact: data });
    }

    const built = contactRow({ ...body, actor: user.email || null });
    if (built.error) return json(400, { error: built.error });
    if (built.row.is_primary === true) {
      await sb.from('crm_contacts').update({ is_primary: false }).eq('company_id', built.row.company_id);
    }
    const { data, error } = await sb.from('crm_contacts').insert(built.row).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.contact_add', targetType: 'company', targetId: built.row.company_id, detail: { role: built.row.role } });
    return json(200, { ok: true, contact: data });
  }

  if (request.method === 'DELETE') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const id = url.searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { data: c, error: getErr } = await sb.from('crm_contacts').select('id,company_id').eq('id', id).maybeSingle();
    if (getErr) return json(500, { error: getErr.message });
    if (!c) return json(404, { error: 'not_found' });
    const { error } = await sb.from('crm_contacts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.contact_delete', targetType: 'company', targetId: c.company_id, detail: { contact: id } });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}

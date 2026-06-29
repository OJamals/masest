// /api/admin/crm/contacts — staff CRM contact records on a company (slice 4).
// Multiple named contacts per account with role/title/email/phone + one primary.
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { contactEmailKey, contactRow, contactPatch, mergeFields, parseContactsCsv, prepareContactImportRows, CONTACT_ROLES } from '../../../_lib/crm-contacts.js';
import { parsePage, pageEnvelope } from '../../../_lib/paginate.js';
import { upsertCrispPerson } from '../../../_lib/crisp.js';

const SELECT = 'id,company_id,name,role,title,email,phone,is_primary,notes,created_by,created_at,updated_at';

function isMissingCrmContactsTable(error) {
  return /does not exist|relation|schema cache/i.test(error?.message || '');
}

function isCrmContactUniqueConflict(error) {
  return /crm_contacts_company_email_uniq|duplicate key value|23505/i.test([
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(' '));
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

    if (body.action === 'import') {
      const companyId = String(body.company_id || '').trim();
      if (!companyId) return json(400, { error: 'company_required' });
      const parsed = parseContactsCsv(body.csv || '');
      if (!parsed.length) return json(400, { error: 'no_rows' });
      const prepared = prepareContactImportRows(parsed, { companyId, actor: user.email || null });
      const errors = [...prepared.errors];
      const existingEmailKeys = new Set();
      if (prepared.emailKeys.length) {
        const { data: existing, error: existingErr } = await sb.from('crm_contacts')
          .select('email')
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .not('email', 'is', null)
          .limit(2000);
        if (existingErr) {
          if (isMissingCrmContactsTable(existingErr)) {
            return json(200, { ok: false, inserted: 0, skipped: errors.length, skipped_duplicates: errors.filter((entry) => entry.error === 'duplicate_email').length, errors: errors.slice(0, 10), needs_migration: true });
          }
          return json(500, { error: existingErr.message });
        }
        for (const contact of existing || []) {
          const key = contactEmailKey(contact.email);
          if (key) existingEmailKeys.add(key);
        }
      }
      const entries = prepared.entries.filter((entry) => {
        if (entry.emailKey && existingEmailKeys.has(entry.emailKey)) {
          errors.push({ row: entry.rowNumber, error: 'duplicate_email', email: entry.emailKey });
          return false;
        }
        return true;
      });
      const rows = entries.map((entry) => entry.row);
      const duplicateSkips = errors.filter((entry) => entry.error === 'duplicate_email').length;
      let inserted = 0;
      if (rows.length) {
        const { data, error } = await sb.from('crm_contacts').insert(rows).select('id');
        if (isCrmContactUniqueConflict(error)) {
          return json(409, { error: 'duplicate_email', message: 'One or more contacts already exist. Refresh and retry the import.' });
        }
        if (error) return json(500, { error: error.message });
        inserted = (data || []).length;
      }
      await recordAudit(sb, { user, action: 'crm.contact_import', targetType: 'company', targetId: companyId, detail: { inserted, skipped: errors.length, skipped_duplicates: duplicateSkips } });
      return json(200, { ok: true, inserted, skipped: errors.length, skipped_duplicates: duplicateSkips, errors: errors.slice(0, 10) });
    }

    if (body.action === 'merge') {
      const fromId = Number(body.from_id);
      const intoId = Number(body.into_id);
      if (!fromId || !intoId || fromId === intoId) return json(400, { error: 'invalid_merge' });
      const { data: rows, error: gErr } = await sb.from('crm_contacts')
        .select('id,company_id,name,title,email,phone,is_primary').in('id', [fromId, intoId]).is('deleted_at', null);
      if (gErr) return json(500, { error: gErr.message });
      const from = (rows || []).find((r) => r.id === fromId);
      const into = (rows || []).find((r) => r.id === intoId);
      if (!from || !into) return json(404, { error: 'not_found' });
      if (from.company_id !== into.company_id) return json(400, { error: 'different_company' });

      // Repoint everything the duplicate owns onto the survivor.
      await sb.from('quotes').update({ contact_id: intoId }).eq('contact_id', fromId);
      await sb.from('crm_notes').update({ subject_id: String(intoId) }).eq('subject_type', 'contact').eq('subject_id', String(fromId));
      await sb.from('crm_tasks').update({ subject_id: String(intoId) }).eq('subject_type', 'contact').eq('subject_id', String(fromId));

      // Backfill the survivor's blank fields, then retire the duplicate.
      const fill = mergeFields(into, from);
      if (Object.keys(fill).length) await sb.from('crm_contacts').update(fill).eq('id', intoId);
      await sb.from('crm_contacts').update({ deleted_at: new Date().toISOString() }).eq('id', fromId);

      const { data: survivor } = await sb.from('crm_contacts').select(SELECT).eq('id', intoId).single();
      await recordAudit(sb, { user, action: 'crm.contact_merge', targetType: 'company', targetId: into.company_id, detail: { from: fromId, into: intoId } });
      return json(200, { ok: true, contact: survivor });
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
      // Propagate the edit to Crisp People so the operator-facing profile stays in sync. Best-effort.
      if (data?.email) {
        const { data: co } = await sb.from('companies').select('name').eq('id', data.company_id).maybeSingle();
        await upsertCrispPerson(env, { email: data.email, name: data.name, company: co?.name, phone: data.phone });
      }
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
    // Seed the contact into Crisp People so operators see CRM context if they chat. Best-effort.
    if (built.row.email) {
      const { data: co } = await sb.from('companies').select('name').eq('id', built.row.company_id).maybeSingle();
      await upsertCrispPerson(env, { email: built.row.email, name: built.row.name, company: co?.name, phone: built.row.phone });
    }
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

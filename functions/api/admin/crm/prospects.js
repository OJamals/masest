// Staff-only Prospect directory. Prospect Organizations remain separate from
// customer Companies until an explicit linked_company_id conversion.
import {
  adminClient,
  internalServerError,
  json,
  requireStaff,
} from '../../../_lib/supabase.js';
import { staffCan } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { pageEnvelope } from '../../../_lib/paginate.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../../_lib/request-body.js';
import {
  isMissingProspectSchema,
  prospectListParams,
  prospectPatch,
  safeProspectSearch,
} from '../../../_lib/crm-prospects.js';

const PROSPECT_REQUEST_MAX_BYTES = 32 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANIZATION_LIST_SELECT = [
  'id', 'name', 'segment', 'city', 'state', 'status', 'priority',
  'marketing_consent', 'outreach_status', 'linked_company_id',
  'retention_review_at', 'updated_at',
].join(',');
const ORGANIZATION_DETAIL_SELECT = [
  ORGANIZATION_LIST_SELECT, 'address', 'postal_code', 'location', 'general_email',
  'phone', 'website', 'linkedin', 'created_at',
].join(',');
const CONTACT_SELECT = [
  'id', 'name', 'title', 'email', 'phone', 'linkedin', 'marketing_consent',
  'outreach_status', 'needs_verification', 'retention_review_at',
].join(',');

function migrationResponse() {
  return json(200, { prospects: [], total: 0, has_more: false, needs_migration: true });
}

async function detail(sb, id) {
  const { data: organization, error } = await sb.from('prospect_organizations')
    .select(ORGANIZATION_DETAIL_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    if (isMissingProspectSchema(error)) return { needsMigration: true };
    throw error;
  }
  if (!organization) return { notFound: true };

  const [contactResult, sourceResult] = await Promise.all([
    sb.from('prospect_contacts').select(CONTACT_SELECT)
      .eq('organization_id', id).is('deleted_at', null).order('name', { ascending: true }),
    sb.from('prospect_source_records').select('source_record_id', { count: 'exact', head: true })
      .eq('organization_id', id),
  ]);
  if (contactResult.error) {
    if (isMissingProspectSchema(contactResult.error)) return { needsMigration: true };
    throw contactResult.error;
  }
  if (sourceResult.error) {
    if (isMissingProspectSchema(sourceResult.error)) return { needsMigration: true };
    throw sourceResult.error;
  }

  let linkedCompany = null;
  if (organization.linked_company_id) {
    const { data, error: companyError } = await sb.from('companies')
      .select('id,name,status')
      .eq('id', organization.linked_company_id)
      .maybeSingle();
    if (companyError) throw companyError;
    linkedCompany = data || null;
  }
  return {
    prospect: {
      ...organization,
      contacts: contactResult.data || [],
      source_record_count: sourceResult.count || 0,
      linked_company: linkedCompany,
    },
  };
}

async function list(sb, params) {
  let query = sb.from('prospect_organizations')
    .select(ORGANIZATION_LIST_SELECT, { count: 'exact' })
    .is('deleted_at', null);
  if (params.q.length >= 2) {
    const like = `%${safeProspectSearch(params.q)}%`;
    query = query.or(`name.ilike.${like},segment.ilike.${like},city.ilike.${like},state.ilike.${like},general_email.ilike.${like},phone.ilike.${like}`);
  }
  if (params.status) query = query.eq('status', params.status);
  if (params.priority) query = query.eq('priority', params.priority);
  const result = await query
    .order('updated_at', { ascending: false })
    .order('name', { ascending: true })
    .range(params.offset, params.offset + params.limit - 1);
  if (result.error) {
    if (isMissingProspectSchema(result.error)) return { needsMigration: true };
    throw result.error;
  }

  const rows = result.data || [];
  const ids = rows.map((row) => row.id);
  const counts = new Map();
  if (ids.length) {
    const contactResult = await sb.from('prospect_contacts').select('organization_id')
      .in('organization_id', ids).is('deleted_at', null);
    if (contactResult.error) {
      if (isMissingProspectSchema(contactResult.error)) return { needsMigration: true };
      throw contactResult.error;
    }
    for (const contact of contactResult.data || []) {
      counts.set(contact.organization_id, (counts.get(contact.organization_id) || 0) + 1);
    }
  }
  const prospects = rows.map((row) => ({ ...row, contact_count: counts.get(row.id) || 0 }));
  return { prospects, ...pageEnvelope(prospects, { ...params, count: result.count }) };
}

async function bodyFrom(request) {
  try {
    const body = await readBoundedJson(request, PROSPECT_REQUEST_MAX_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad_request' };
    return { body };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return { error: 'request_too_large' };
    return { error: 'bad_request' };
  }
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const id = String(url.searchParams.get('id') || '').trim();
    try {
      if (id) {
        if (!UUID_RE.test(id)) return json(400, { error: 'invalid_id' });
        const result = await detail(sb, id);
        if (result.needsMigration) return migrationResponse();
        if (result.notFound) return json(404, { error: 'not_found' });
        return json(200, result);
      }
      const params = prospectListParams(url.searchParams);
      if (params.error) return json(400, { error: params.error });
      const result = await list(sb, params);
      if (result.needsMigration) return migrationResponse();
      return json(200, result);
    } catch (error) {
      return internalServerError('admin.crm.prospects.get', error);
    }
  }

  if (request.method === 'PATCH') {
    if (!staffCan(role, 'prospect.write')) return json(403, { error: 'forbidden' });
    const parsed = await bodyFrom(request);
    if (parsed.error) return json(parsed.error === 'request_too_large' ? 413 : 400, { error: parsed.error });
    const id = String(parsed.body.id || '').trim();
    if (!UUID_RE.test(id)) return json(400, { error: 'invalid_id' });
    try {
      const { data: existing, error: getError } = await sb.from('prospect_organizations')
        .select('id,status,linked_company_id').eq('id', id).is('deleted_at', null).maybeSingle();
      if (getError) {
        if (isMissingProspectSchema(getError)) return json(409, { error: 'migration_required' });
        throw getError;
      }
      if (!existing) return json(404, { error: 'not_found' });
      const built = prospectPatch(parsed.body, existing, new Date());
      if (built.error) return json(400, { error: built.error });
      if (built.patch.linked_company_id) {
        const { data: company, error: companyError } = await sb.from('companies')
          .select('id').eq('id', built.patch.linked_company_id).maybeSingle();
        if (companyError) throw companyError;
        if (!company) return json(400, { error: 'company_not_found' });
      }
      const { data, error } = await sb.from('prospect_organizations')
        .update(built.patch).eq('id', id).select(ORGANIZATION_DETAIL_SELECT).single();
      if (error) throw error;
      await recordAudit(sb, {
        user,
        action: 'crm.prospect_update',
        targetType: 'prospect_organization',
        targetId: id,
        detail: { fields: Object.keys(built.patch).filter((key) => key !== 'updated_at') },
      });
      return json(200, { ok: true, prospect: data });
    } catch (error) {
      return internalServerError('admin.crm.prospects.patch', error);
    }
  }

  if (request.method === 'DELETE') {
    if (!staffCan(role, 'prospect.delete')) return json(403, { error: 'forbidden' });
    const id = String(url.searchParams.get('id') || '').trim();
    const confirm = String(url.searchParams.get('confirm') || '');
    if (!UUID_RE.test(id)) return json(400, { error: 'invalid_id' });
    if (confirm !== 'erase') return json(400, { error: 'erase_confirmation_required' });
    try {
      const { data: existing, error: getError } = await sb.from('prospect_organizations')
        .select('id').eq('id', id).maybeSingle();
      if (getError) throw getError;
      if (!existing) return json(404, { error: 'not_found' });
      const { error } = await sb.from('prospect_organizations').delete().eq('id', id);
      if (error) throw error;
      await recordAudit(sb, {
        user,
        action: 'crm.prospect_erase',
        targetType: 'prospect_organization',
        targetId: id,
        detail: { cascade: ['prospect_contacts', 'prospect_source_records'] },
      });
      return json(200, { ok: true });
    } catch (error) {
      return internalServerError('admin.crm.prospects.delete', error);
    }
  }

  return json(405, { error: 'method_not_allowed' });
}

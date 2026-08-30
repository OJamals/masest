// /api/admin/customers — flattened directory of all account members across
// companies, with email, role, company, status and pricing tier. Read-only.
import {
  adminClient,
  allUserEmails,
  emailsByIds,
  internalServerError,
  json,
  requireStaff,
} from '../../_lib/supabase.js';
import { csvResponse } from '../../_lib/reports.js';

const PROFILE_ROLES = new Set(['buyer', 'admin', 'moderator']);

export function customerDirectoryParams(input) {
  const params = new URL(input).searchParams;
  const q = String(params.get('q') || '').trim().slice(0, 120) || null;
  const rawRole = String(params.get('role') || '').trim();
  if (rawRole && !PROFILE_ROLES.has(rawRole)) return { error: 'invalid_role' };
  const rawLimit = Number.parseInt(params.get('limit') || '50', 10);
  const rawOffset = Number.parseInt(params.get('offset') || '0', 10);
  return {
    q,
    role: rawRole || null,
    limit: Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
  };
}

async function fullCustomerExport(sb) {
  const { data: profiles, error: profilesError } = await sb.from('profiles')
    .select('id,full_name,phone,role,company_id');
  if (profilesError) throw profilesError;
  const { data: companies, error: companiesError } = await sb.from('companies')
    .select('id,name,status,price_tier,net_terms_days');
  if (companiesError) throw companiesError;
  const companyById = new Map((companies || []).map((company) => [company.id, company]));
  const emailById = await allUserEmails(sb, { strict: true });
  const customers = (profiles || []).map((profile) => {
    const company = companyById.get(profile.company_id) || {};
    return {
      id: profile.id,
      email: emailById.get(profile.id) || null,
      full_name: profile.full_name || null,
      phone: profile.phone || null,
      role: profile.role || null,
      company_id: profile.company_id || null,
      company_name: company.name || null,
      company_status: company.status || null,
      price_tier: company.price_tier || 'retail',
      net_terms_days: company.net_terms_days || 0,
    };
  });
  customers.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));
  return customers;
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const sb = adminClient(env);
  if (new URL(request.url).searchParams.get('export') === 'csv') {
    let customers;
    try { customers = await fullCustomerExport(sb); }
    catch (error) { return internalServerError('admin.customers.csv', error); }
    const rows = [['Name', 'Email', 'Phone', 'Role', 'Company', 'Company status', 'Tier', 'NET days']];
    for (const c of customers) {
      rows.push([c.full_name || '', c.email || '', c.phone || '', c.role || '', c.company_name || '', c.company_status || '', c.price_tier, c.net_terms_days]);
    }
    return csvResponse(rows, 'masest-customers');
  }

  const page = customerDirectoryParams(request.url);
  if (page.error) return json(400, { error: page.error });
  const { data, error } = await sb.rpc('admin_customer_directory', {
    p_search: page.q,
    p_role: page.role,
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (error) return internalServerError('admin.customers.directory', error);
  const rows = data || [];
  const total = Number(rows[0]?.total_count || 0);
  const customers = rows.map(({ total_count, ...customer }) => customer);
  const emailById = await emailsByIds(sb, customers.map((customer) => customer.id));
  customers.forEach((customer) => { customer.email = emailById[customer.id] || null; });
  return json(200, {
    customers,
    total,
    has_more: page.offset + customers.length < total,
    limit: page.limit,
    offset: page.offset,
  });
}

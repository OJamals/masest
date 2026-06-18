// /api/admin/customers — flattened directory of all account members across
// companies, with email, role, company, status and pricing tier. Read-only.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const sb = adminClient(env);
  const { data: profiles, error } = await sb.from('profiles').select('id,full_name,phone,role,company_id');
  if (error) return json(500, { error: error.message });
  const { data: companies } = await sb.from('companies').select('id,name,status,price_tier,net_terms_days');
  const companyById = new Map((companies || []).map((c) => [c.id, c]));

  const emailById = new Map();
  try {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of list?.users || []) emailById.set(u.id, u.email);
  } catch { /* email lookup best-effort */ }

  const customers = (profiles || []).map((p) => {
    const c = companyById.get(p.company_id) || {};
    return {
      id: p.id, email: emailById.get(p.id) || null, full_name: p.full_name || null, phone: p.phone || null,
      role: p.role || null, company_id: p.company_id || null, company_name: c.name || null,
      company_status: c.status || null, price_tier: c.price_tier || 'retail', net_terms_days: c.net_terms_days || 0,
    };
  });
  customers.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));
  return json(200, { customers });
}

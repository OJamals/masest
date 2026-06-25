// GET /api/admin/company?id=<uuid> — full detail for one company. Staff-only.
// Returns the company, its members (+ emails), recent orders, message count, pending invites.
import { adminClient, requireStaff, json, emailsByIds } from '../../_lib/supabase.js';
import { buildCompanySetup } from '../../_lib/setup.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'id_required' });

  const sb = adminClient(env);
  const { data: company } = await sb.from('companies')
    .select('id,name,status,net_terms_days,credit_limit,tax_exempt,resale_cert_url,stripe_customer_id,created_at')
    .eq('id', id).maybeSingle();
  if (!company) return json(404, { error: 'not_found' });

  // Business verification dossier (schema-business-profile.sql). Selected separately and
  // defensively so the company detail still loads if that migration has not been applied.
  let business = {};
  try {
    const { data: biz } = await sb.from('companies')
      .select('legal_name,dba,entity_type,tax_id,business_phone,business_email,website,industry,est_annual_volume,requested_net_terms,contact_name,contact_title,submitted_at,verified_at,rejection_reason')
      .eq('id', id).maybeSingle();
    if (biz) business = biz;
  } catch { business = {}; }

  const { data: profiles } = await sb.from('profiles').select('id,full_name,phone,role').eq('company_id', id);
  const emails = await emailsByIds(sb, (profiles || []).map((p) => p.id));
  const members = (profiles || []).map((p) => ({ ...p, email: emails[p.id] || null }));

  const { data: orders } = await sb.from('orders')
    .select('id,status,payment_method,total,currency,created_at')
    .eq('company_id', id).neq('status', 'cart').order('created_at', { ascending: false }).limit(50);

  let message_count = 0;
  try { const { count } = await sb.from('messages').select('*', { count: 'exact', head: true }).eq('company_id', id); message_count = count || 0; } catch {}

  const { data: invites } = await sb.from('company_invites')
    .select('id,email,role,status').eq('company_id', id).eq('status', 'pending');

  return json(200, {
    company: { ...company, ...business, setup: buildCompanySetup(company, profiles || []) },
    members,
    orders: orders || [],
    message_count,
    invites: invites || [],
  });
}

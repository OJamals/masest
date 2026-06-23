// GET /api/admin/impersonate?company_id= — read-only "view as customer" support
// snapshot (#100). Staff-only, fully audited. NOT an auth takeover: returns the
// company's dashboard-shaped data; it never acts as the user and performs no writes.
import { adminClient, requireStaff, json, emailsByIds } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { companyCreditState } from '../../_lib/credit.js';
import { staffCan } from '../../_lib/authz.js';

export async function onRequestGet({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCan(role, 'company.view_as')) {
    return json(403, { error: 'forbidden', message: 'Support view-as requires support access.' });
  }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return json(400, { error: 'company_id_required' });

  const sb = adminClient(env);
  const { data: company } = await sb.from('companies')
    .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier')
    .eq('id', companyId).maybeSingle();
  if (!company) return json(404, { error: 'not_found' });

  const { data: profiles } = await sb.from('profiles')
    .select('id,full_name,phone,role').eq('company_id', companyId);
  const emailById = await emailsByIds(sb, (profiles || []).map((p) => p.id));
  const members = (profiles || []).map((p) => ({ ...p, email: emailById[p.id] || null }));

  const { data: orders } = await sb.from('orders')
    .select('id,status,payment_method,total,currency,created_at,tracking_status')
    .eq('company_id', companyId).neq('status', 'cart')
    .order('created_at', { ascending: false }).limit(20);

  const { data: addresses } = await sb.from('addresses').select('*').eq('company_id', companyId);
  const { data: subscriptions } = await sb.from('program_subscriptions')
    .select('tier,status,created_at').eq('company_id', companyId).order('created_at', { ascending: false });
  const { count: messageCount } = await sb.from('messages')
    .select('*', { count: 'exact', head: true }).eq('company_id', companyId);

  let credit = null;
  try {
    const s = await companyCreditState(sb, companyId, company.credit_limit);
    credit = { credit_limit: s.credit_limit, net_outstanding: s.outstanding, credit_available: s.available, unlimited: s.unlimited };
  } catch { credit = null; }

  // Audit every support view — who looked at which company, when.
  await recordAudit(sb, { user, action: 'admin.impersonate_view', targetType: 'company', targetId: companyId, detail: { name: company.name } });

  return json(200, {
    read_only: true,
    company,
    members,
    credit,
    orders: orders || [],
    addresses: addresses || [],
    subscriptions: subscriptions || [],
    message_count: messageCount || 0,
  });
}

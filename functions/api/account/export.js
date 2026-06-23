// GET /api/account/export — GDPR data export. Returns the caller's profile, company,
// and every company-scoped record as a single downloadable JSON document.
import { requireCompany, json } from '../../_lib/supabase.js';

// Company-scoped tables holding the account's personal/business data (filtered by company_id).
const COMPANY_TABLES = ['addresses', 'quotes', 'messages', 'notifications', 'program_subscriptions', 'company_invites'];

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  const out = { exported_at: new Date().toISOString(), user: { id: user.id, email: user.email } };

  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  out.profile = profile || null;
  const { data: company } = await sb.from('companies').select('*').eq('id', companyId).maybeSingle();
  out.company = company || null;

  for (const table of COMPANY_TABLES) {
    const { data } = await sb.from(table).select('*').eq('company_id', companyId);
    out[table] = data || [];
  }

  const { data: orders } = await sb.from('orders').select('*').eq('company_id', companyId);
  out.orders = orders || [];
  const orderIds = (orders || []).map((o) => o.id);
  out.order_items = [];
  if (orderIds.length) {
    const { data: items } = await sb.from('order_items').select('*').in('order_id', orderIds);
    out.order_items = items || [];
  }

  return json(200, out, {
    'content-disposition': `attachment; filename="masest-data-export-${companyId}.json"`,
  });
}

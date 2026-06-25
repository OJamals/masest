// GET /api/account/invoices — the business's QuickBooks invoicing portal data.
// Company-scoped (requireCompany). Returns the NET / invoiced orders billed through QuickBooks
// plus a NET-account summary (terms, credit, outstanding balance). This is the business-context
// counterpart to the user-context Stripe card portal: Stripe handles card payments per user,
// QuickBooks handles NET invoicing per business.
import { requireCompany, json } from '../../_lib/supabase.js';
import { companyCreditState } from '../../_lib/credit.js';

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  const { data: company } = await sb
    .from('companies').select('id,name,status,net_terms_days,credit_limit').eq('id', companyId).maybeSingle();
  if (!company) return json(404, { error: 'no_company' });

  // NET invoicing unlocks only after the business is verified/approved.
  const approved = company.status === 'approved';
  if (!approved) {
    return json(200, { approved: false, status: company.status || 'pending', invoices: [], summary: null });
  }

  // Invoiced orders = NET orders (billed via QuickBooks). Select qbo_sync_status defensively so
  // the portal still loads if the QBO migration column is absent.
  let invoices = [];
  const cols = 'id,created_at,status,payment_method,total,currency,qbo_invoice_id,qbo_sync_status';
  let { data, error } = await sb.from('orders')
    .select(cols).eq('company_id', companyId).eq('payment_method', 'net')
    .neq('status', 'cart').order('created_at', { ascending: false }).limit(100);
  if (error) {
    ({ data } = await sb.from('orders')
      .select('id,created_at,status,payment_method,total,currency,qbo_invoice_id')
      .eq('company_id', companyId).eq('payment_method', 'net')
      .neq('status', 'cart').order('created_at', { ascending: false }).limit(100));
  }
  invoices = (data || []).map((o) => ({
    id: o.id,
    created_at: o.created_at,
    status: o.status,
    total: o.total,
    currency: o.currency || 'usd',
    qbo_invoice_id: o.qbo_invoice_id || null,
    qbo_sync_status: o.qbo_sync_status || (o.qbo_invoice_id ? 'synced' : 'pending'),
    paid: o.status === 'net_paid',
  }));

  let summary = null;
  try {
    const state = await companyCreditState(sb, companyId, company.credit_limit);
    summary = {
      net_terms_days: company.net_terms_days || 0,
      credit_limit: state.credit_limit,
      net_outstanding: state.outstanding,
      credit_available: state.available,
      unlimited: state.unlimited,
    };
  } catch {
    summary = { net_terms_days: company.net_terms_days || 0, credit_limit: null, net_outstanding: 0, credit_available: null, unlimited: true };
  }

  return json(200, { approved: true, status: 'approved', invoices, summary });
}

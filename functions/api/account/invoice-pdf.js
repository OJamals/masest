// GET /api/account/invoice-pdf?id=<orderId> — self-serve QuickBooks invoice PDF.
// Company-scoped (requireCompany): the order must belong to the caller's company
// and carry a synced qbo_invoice_id. Proxies the PDF bytes straight back so the
// browser can download them. Degrades to 503 when QuickBooks isn't connected
// (owner op), so the UI can hide the control instead of erroring.
import { requireCompany, json } from '../../_lib/supabase.js';
import { getAccessToken, qboBaseUrl } from '../../_lib/qbo.js';

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'id_required' });

  // Ownership + eligibility: an order of THIS company with an issued QuickBooks invoice
  // (card orders sync as Invoice+Payment too, so both NET and card orders can qualify).
  const { data: order, error } = await sb.from('orders')
    .select('id,company_id,payment_method,qbo_invoice_id')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  if (!order) return json(404, { error: 'not_found' });
  if (!order.qbo_invoice_id) return json(409, { error: 'no_invoice', message: 'This order does not have a QuickBooks invoice yet.' });

  let creds;
  try {
    creds = await getAccessToken(sb, env);
  } catch (err) {
    const code = String(err?.message || '');
    // Owner hasn't connected / configured QuickBooks yet — not the caller's fault.
    if (code.startsWith('qbo_not_connected') || code.startsWith('qbo_oauth_not_configured') || code.startsWith('qbo_refresh')) {
      return json(503, { error: 'qbo_unavailable', message: 'Invoice downloads are temporarily unavailable.' });
    }
    return json(502, { error: 'qbo_error' });
  }
  if (!creds.realmId) return json(503, { error: 'qbo_unavailable', message: 'Invoice downloads are temporarily unavailable.' });

  const url = `${qboBaseUrl(env)}/v3/company/${creds.realmId}/invoice/${encodeURIComponent(order.qbo_invoice_id)}/pdf?minorversion=70`;
  let pdfRes;
  try {
    pdfRes = await fetch(url, { headers: { authorization: `Bearer ${creds.accessToken}`, accept: 'application/pdf' } });
  } catch {
    return json(502, { error: 'qbo_fetch_failed' });
  }
  if (!pdfRes.ok) return json(502, { error: 'qbo_pdf_failed', status: pdfRes.status });

  const bytes = await pdfRes.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="invoice-${order.qbo_invoice_id}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}

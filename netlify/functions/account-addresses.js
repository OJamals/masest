// /api/account/addresses — saved ship/bill addresses for the caller's company.
//   GET                       → { addresses: [...] }
//   POST  { address }         → create (server sets company_id; cannot spoof another company)
//   DELETE { id } | ?id=<id>  → remove one of the company's addresses
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../lib/supabase.js';

const FIELDS = ['type', 'line1', 'line2', 'city', 'state', 'zip', 'country', 'is_default'];

export default async (req) => {
  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient();
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('addresses')
      .select('id,type,line1,line2,city,state,zip,country,is_default,created_at')
      .eq('company_id', companyId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: error.message });
    return json(200, { addresses: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const a = body.address || body || {};
    if (!a.line1 || !a.city || !a.state || !a.zip) {
      return json(400, { error: 'address_incomplete', need: ['line1', 'city', 'state', 'zip'] });
    }
    const row = { company_id: companyId, type: a.type === 'bill' ? 'bill' : 'ship', country: 'US' };
    for (const f of FIELDS) if (a[f] !== undefined && f !== 'type') row[f] = a[f];

    // Only one default per (company, type): clear the rest first.
    if (row.is_default) {
      await sb.from('addresses').update({ is_default: false })
        .eq('company_id', companyId).eq('type', row.type);
    }
    const { data, error } = await sb.from('addresses').insert(row).select('id').single();
    if (error) return json(500, { error: error.message });
    return json(201, { id: data.id });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    const id = body.id || new URL(req.url).searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { error } = await sb.from('addresses').delete()
      .eq('id', id).eq('company_id', companyId);   // scoped delete — cannot remove others' rows
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
};

export const config = { path: '/api/account/addresses' };

// /api/admin/offers — staff broadcasts. GET → past sends · POST → in-app notification fan-out
// (+ optional Resend email when send_email and RESEND_API_KEY are set).
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';

const AUDIENCES = ['all', 'approved', 'pending', 'company'];

async function targetCompanies(sb, audience, companyId) {
  let q = sb.from('companies').select('id');
  if (audience === 'company') q = q.eq('id', companyId);
  else if (audience !== 'all') q = q.eq('status', audience);
  const { data } = await q;
  return (data || []).map((c) => c.id);
}

async function memberEmails(sb, companyIds) {
  if (!companyIds.length) return [];
  const set = new Set(companyIds);
  const { data: profiles } = await sb.from('profiles').select('id,company_id');
  const wanted = new Set((profiles || []).filter((p) => set.has(p.company_id)).map((p) => p.id));
  if (!wanted.size) return [];
  const emails = [];
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users || []) if (wanted.has(u.id) && u.email) emails.push(u.email);
  } catch { /* auth admin unavailable */ }
  return [...new Set(emails)];
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data, error } = await sb.from('offers').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) return json(500, { error: error.message });
    return json(200, { offers: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const title = String(body.title || '').trim();
    const audience = AUDIENCES.includes(body.audience) ? body.audience : 'approved';
    if (!title) return json(400, { error: 'title_required' });
    if (audience === 'company' && !body.company_id) return json(400, { error: 'company_id_required' });

    const companyIds = await targetCompanies(sb, audience, body.company_id);
    if (!companyIds.length) return json(200, { ok: true, recipients: 0, message: 'No companies match.' });

    await sb.from('notifications').insert(companyIds.map((cid) => ({
      company_id: cid, type: 'offer', title,
      body: String(body.body || '').slice(0, 1000) || null, link: body.cta_url || '/products.html',
    }))).then(() => {}, () => {});

    let emailed = false;
    if (body.send_email && env.RESEND_API_KEY) {
      const emails = await memberEmails(sb, companyIds);
      if (emails.length) {
        const from = env.RESEND_FROM || 'MASEST <noreply@send.masest.co>';
        const html = `<h2>${title}</h2><p>${String(body.body || '')}</p>` +
          (body.cta_url ? `<p><a href="${body.cta_url}">View</a></p>` : '');
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from, to: emails.slice(0, 1), bcc: emails.slice(1, 50), subject: title, html }),
          });
          emailed = r.ok;
        } catch { emailed = false; }
      }
    }

    const { data: offer } = await sb.from('offers').insert({
      title, body: body.body || null, cta_url: body.cta_url || null,
      audience, company_id: audience === 'company' ? body.company_id : null,
      created_by: user.email || null, recipients: companyIds.length, emailed,
    }).select('id').single();

    return json(201, { ok: true, id: offer?.id, recipients: companyIds.length, emailed });
  }

  return json(405, { error: 'method_not_allowed' });
}

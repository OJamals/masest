// /api/admin/offers — staff broadcasts (offers / announcements) to buyers.
//   GET                                  → { offers: [...] } past sends
//   POST { title, body, cta_url?, audience, company_id?, send_email? }
//        Always creates an in-app notification for every targeted company.
//        send_email:true also emails company members via Resend (best-effort) — outward-facing,
//        so it only fires when explicitly requested AND RESEND_API_KEY is set.
import { adminClient, requireStaff, json, readBody } from '../lib/supabase.js';

const AUDIENCES = ['all', 'approved', 'pending', 'company'];

async function targetCompanies(sb, audience, companyId) {
  let q = sb.from('companies').select('id');
  if (audience === 'company') q = q.eq('id', companyId);
  else if (audience !== 'all') q = q.eq('status', audience); // 'approved' | 'pending'
  const { data } = await q;
  return (data || []).map((c) => c.id);
}

// Resolve member emails for the targeted companies via the Supabase auth admin API + profiles map.
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
  } catch { /* auth admin unavailable → skip email */ }
  return [...new Set(emails)];
}

export default async (req) => {
  const { user, staff } = await requireStaff(req);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient();

  if (req.method === 'GET') {
    const { data, error } = await sb.from('offers')
      .select('*').order('created_at', { ascending: false }).limit(100);
    if (error) return json(500, { error: error.message });
    return json(200, { offers: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    const audience = AUDIENCES.includes(body.audience) ? body.audience : 'approved';
    if (!title) return json(400, { error: 'title_required' });
    if (audience === 'company' && !body.company_id) return json(400, { error: 'company_id_required' });

    const companyIds = await targetCompanies(sb, audience, body.company_id);
    if (!companyIds.length) return json(200, { ok: true, recipients: 0, message: 'No companies match.' });

    // In-app notification per company (always).
    const notifs = companyIds.map((cid) => ({
      company_id: cid, type: 'offer', title,
      body: String(body.body || '').slice(0, 1000) || null,
      link: body.cta_url || '/products.html',
    }));
    await sb.from('notifications').insert(notifs).then(() => {}, () => {});

    // Optional email blast.
    let emailed = false;
    if (body.send_email && process.env.RESEND_API_KEY) {
      const emails = await memberEmails(sb, companyIds);
      if (emails.length) {
        const from = process.env.RESEND_FROM || 'MASEST <noreply@send.masest.co>';
        const html = `<h2>${title}</h2><p>${String(body.body || '')}</p>` +
          (body.cta_url ? `<p><a href="${body.cta_url}">View</a></p>` : '');
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
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
};

export const config = { path: '/api/admin/offers' };

// /api/admin/crm/timeline — virtual, read-time merge of a contact's activity.
// Queries existing per-company signals + crm_notes/crm_tasks; never instruments
// write paths. Each source is wrapped in safe() so a missing table degrades to [].
import { adminClient, json, requireStaff, companyEmails } from '../../../_lib/supabase.js';
import { mergeTimeline, validSubject, filterCompanyEmails } from '../../../_lib/crm.js';

// Resolve a company's known email addresses — member accounts (via auth) + CRM contacts —
// so deliverability events can be matched to it. Best-effort, deduped, bounded.
async function companyEmailSet(sb, env, companyId) {
  const [members, contacts] = await Promise.all([
    companyEmails(sb, companyId).catch(() => []),
    safe(sb.from('crm_contacts').select('email').eq('company_id', companyId).is('deleted_at', null).not('email', 'is', null).limit(100)).then((rows) => rows.map((r) => r.email)),
  ]);
  return [...new Set([...members, ...contacts].map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))].slice(0, 25);
}

async function safe(builder) {
  try {
    const { data, error } = await builder;
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(request.url);
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');
  if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });

  const sb = adminClient(env);
  const id = String(subjectId);

  const notesP = safe(sb.from('crm_notes').select('id,kind,body,created_by,created_at').eq('subject_type', subjectType).eq('subject_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(200));
  const tasksP = safe(sb.from('crm_tasks').select('id,title,assigned_to,created_by,created_at,completed_at,completed_by').eq('subject_type', subjectType).eq('subject_id', id).limit(200));

  let extra = { orders: [], messages: [], shipments: [], audit: [], quotes: [] };
  if (subjectType === 'company') {
    const [orders, messages, audit, company] = await Promise.all([
      safe(sb.from('orders').select('id,status,total,currency,created_at').eq('company_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('messages').select('id,sender_role,body,created_at').eq('company_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('audit_log').select('action,actor_email,created_at').eq('target_type', 'company').eq('target_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('companies').select('name').eq('id', id).limit(1)),
    ]);
    const name = company[0]?.name;
    const orderIds = orders.map((o) => o.id);
    const [shipments, quotes] = await Promise.all([
      orderIds.length ? safe(sb.from('shipment_events').select('order_id,status,carrier,tracking_number,created_at').in('order_id', orderIds).order('created_at', { ascending: false }).limit(100)) : Promise.resolve([]),
      name ? safe(sb.from('quotes').select('id,type,status,product,created_at').ilike('company', name).order('created_at', { ascending: false }).limit(50)) : Promise.resolve([]),
    ]);
    // Deliverability: match email_events to the company's emails. to_email is a comma-joined
    // recipient list, so a per-address ILIKE (PostgREST-parameterized → no injection) finds
    // events regardless of age; filterCompanyEmails dedups and re-confirms the match.
    const addrs = await companyEmailSet(sb, env, id);
    const eventLists = await Promise.all(addrs.map((addr) =>
      safe(sb.from('email_events').select('id,to_email,category,subject,status,created_at').ilike('to_email', `%${addr}%`).order('created_at', { ascending: false }).limit(50))));
    const emails = filterCompanyEmails(eventLists.flat(), addrs);
    extra = { orders, messages, audit, shipments, quotes, emails };
  } else if (subjectType === 'contact') {
    // A contact's activity = the deals it's the buyer on (quotes.contact_id) + its notes/tasks.
    const quotes = await safe(sb.from('quotes').select('id,type,status,product,created_at').eq('contact_id', Number(id) || -1).order('created_at', { ascending: false }).limit(50));
    extra = { ...extra, quotes };
  }

  const [notes, tasks] = await Promise.all([notesP, tasksP]);
  const timeline = mergeTimeline({ ...extra, notes, tasks });
  return json(200, { timeline });
}

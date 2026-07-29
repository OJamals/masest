import { companyEmails } from './supabase.js';
import { escapeLike, filterCompanyEmails, mergeTimeline, validSubject } from './crm.js';

export function createCrmActivityModule({ store } = {}) {
  if (!store) throw new Error('crm_activity_store_required');

  async function timeline({ subjectType, subjectId } = {}) {
    if (!validSubject(subjectType, subjectId)) return { ok: false, error: 'invalid_subject' };

    const id = String(subjectId);
    const notesP = store.notes(subjectType, id);
    const tasksP = store.tasks(subjectType, id);
    let extra = { orders: [], messages: [], shipments: [], audit: [], quotes: [], emails: [] };

    if (subjectType === 'company') {
      const [core, addresses] = await Promise.all([
        store.companyCore(id),
        store.companyAddresses(id),
      ]);
      const orderIds = core.orders.map((order) => order.id);
      const [shipments, quotes, emailEvents] = await Promise.all([
        store.shipments(orderIds),
        store.quotesByCompany(core.companyName),
        store.emailEvents(addresses),
      ]);
      extra = {
        orders: core.orders,
        messages: core.messages,
        audit: core.audit,
        shipments,
        quotes,
        emails: filterCompanyEmails(emailEvents, addresses),
      };
    } else if (subjectType === 'contact') {
      extra.quotes = await store.quotesByContact(Number(id) || -1);
    }

    const [notes, tasks] = await Promise.all([notesP, tasksP]);
    return { ok: true, timeline: mergeTimeline({ ...extra, notes, tasks }) };
  }

  return { timeline };
}

async function safeRows(builder) {
  try {
    const { data, error } = await builder;
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

export function createSupabaseCrmActivityStore({ sb } = {}) {
  if (!sb) throw new Error('supabase_client_required');

  return {
    notes(subjectType, subjectId) {
      return safeRows(sb.from('crm_notes')
        .select('id,kind,body,created_by,created_at')
        .eq('subject_type', subjectType)
        .eq('subject_id', subjectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200));
    },

    tasks(subjectType, subjectId) {
      return safeRows(sb.from('crm_tasks')
        .select('id,title,assigned_to,created_by,created_at,completed_at,completed_by')
        .eq('subject_type', subjectType)
        .eq('subject_id', subjectId)
        .limit(200));
    },

    async companyCore(companyId) {
      const [orders, messages, audit, company] = await Promise.all([
        safeRows(sb.from('orders').select('id,status,total,currency,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100)),
        safeRows(sb.from('messages').select('id,sender_role,body,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100)),
        safeRows(sb.from('audit_log').select('action,actor_email,created_at').eq('target_type', 'company').eq('target_id', companyId).order('created_at', { ascending: false }).limit(100)),
        safeRows(sb.from('companies').select('name').eq('id', companyId).limit(1)),
      ]);
      return { orders, messages, audit, companyName: company[0]?.name };
    },

    shipments(orderIds) {
      if (!orderIds.length) return Promise.resolve([]);
      return safeRows(sb.from('shipment_events')
        .select('order_id,status,carrier,tracking_number,created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100));
    },

    quotesByCompany(companyName) {
      if (!companyName) return Promise.resolve([]);
      return safeRows(sb.from('quotes')
        .select('id,type,status,product,created_at')
        .ilike('company', escapeLike(companyName))
        .order('created_at', { ascending: false })
        .limit(50));
    },

    async companyAddresses(companyId) {
      const [members, contacts] = await Promise.all([
        companyEmails(sb, companyId).catch(() => []),
        safeRows(sb.from('crm_contacts')
          .select('email')
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .not('email', 'is', null)
          .limit(100)).then((rows) => rows.map((row) => row.email)),
      ]);
      return [...new Set([...members, ...contacts]
        .map((email) => String(email || '').toLowerCase().trim())
        .filter(Boolean))]
        .slice(0, 25);
    },

    async emailEvents(addresses) {
      const eventLists = await Promise.all(addresses.map((address) =>
        safeRows(sb.from('email_events')
          .select('id,to_email,category,subject,status,created_at')
          .ilike('to_email', `%${escapeLike(address)}%`)
          .order('created_at', { ascending: false })
          .limit(50))));
      return eventLists.flat();
    },

    quotesByContact(contactId) {
      return safeRows(sb.from('quotes')
        .select('id,type,status,product,created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(50));
    },
  };
}

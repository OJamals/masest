import { UUID, salesPage, salesTimeline } from './connected-sales-contract.js?v=20260929e';
const fail = () => { throw new Error('Invalid CRM history response. Retry.'); };
const text = (v, max) => typeof v === 'string' && v.length <= max;
const timestamp = (v) => text(v, 100) && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
export function directoryPage(value) {
  return salesPage(value, (row) => {
    if (!UUID.test(row.staff_id) || !text(row.display_name, 200) || !['owner', 'finance', 'support'].includes(row.role)) fail();
  });
}
export function accountTimeline(value, organizationId) {
  return salesTimeline(value, organizationId, 'organization_id');
}
export function engagementPage(value, personId, section) {
  return salesPage(value, (row) => {
    if (!row || !UUID.test(row.id) || row.person_id !== personId || row.section !== section || !timestamp(row.created_at)) fail();
    if (section === 'activities') {
      if (!text(row.kind, 100) || !text(row.source, 200) || !text(row.reason, 1000) || !timestamp(row.occurred_at) || !(row.note === null || text(row.note, 2000))) fail();
    } else if (section === 'preferences') {
      if (!text(row.channel, 50) || !text(row.reason, 1000) || !['allowed', 'paused', 'suppressed'].includes(row.status)) fail();
    } else if (section === 'handoffs') {
      if (!UUID.test(row.handoff_id) || !Number.isSafeInteger(row.version) || row.version < 1 || !text(row.reason, 1000) || !['requested', 'accepted', 'rejected', 'deferred'].includes(row.status)) fail();
    } else if (section === 'opportunities') { if (!UUID.test(row.handoff_id)) fail(); }
    else fail();
  });
}

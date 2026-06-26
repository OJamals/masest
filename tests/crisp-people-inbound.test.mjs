import assert from 'node:assert/strict';
import test from 'node:test';

const companyId = '11111111-1111-4111-8111-111111111111';

function makeSb({ existingContact = null }) {
  const writes = [];
  const chain = (table) => {
    const c = {
      select: () => c, eq: () => c, is: () => c, in: () => c, gte: () => c, order: () => c, limit: () => c,
      maybeSingle: async () => ({ data: table === 'crm_contacts' ? existingContact : null }),
      upsert: (row) => { writes.push({ table, op: 'upsert', row }); return { select: () => ({ maybeSingle: async () => ({ data: row }) }) }; },
      insert: (row) => { writes.push({ table, op: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }; },
      update: () => ({ eq: () => ({}) }),
    };
    return c;
  };
  return { sb: { from: chain }, writes };
}

const emailEvent = (email, nickname, withCompany = true) => ({
  website_id: 'site', event: 'session:set_email',
  data: { session_id: 's1', website_id: 'site', email, nickname, ...(withCompany ? { data: { account_company_id: companyId } } : {}) },
});

test('a known-account chat lead with an email auto-creates a CRM contact', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ existingContact: null });
  const res = await handleCrispEvent(sb, {}, emailEvent('jane@acme.co', 'Jane'));
  assert.equal(res.session, true);
  const contact = writes.find((w) => w.table === 'crm_contacts' && w.op === 'insert');
  assert.ok(contact, 'contact inserted');
  assert.equal(contact.row.email, 'jane@acme.co');
  assert.equal(contact.row.name, 'Jane');
  assert.equal(contact.row.company_id, companyId);
  assert.equal(contact.row.role, 'other');
  assert.equal(contact.row.created_by, 'crisp:chat');
});

test('falls back to email as name when no nickname', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ existingContact: null });
  await handleCrispEvent(sb, {}, emailEvent('noname@acme.co', ''));
  assert.equal(writes.find((w) => w.table === 'crm_contacts' && w.op === 'insert')?.row.name, 'noname@acme.co');
});

test('does not duplicate an existing contact', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ existingContact: { id: 'c1' } });
  await handleCrispEvent(sb, {}, emailEvent('jane@acme.co', 'Jane'));
  assert.ok(!writes.find((w) => w.table === 'crm_contacts' && w.op === 'insert'), 'no duplicate insert');
});

test('an anonymous chat (no account company) creates no contact', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ existingContact: null });
  await handleCrispEvent(sb, {}, emailEvent('anon@x.co', 'Anon', false));
  assert.ok(!writes.find((w) => w.table === 'crm_contacts' && w.op === 'insert'), 'no contact without a real company');
});

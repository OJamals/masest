import assert from 'node:assert/strict';
import test from 'node:test';

const companyId = '11111111-1111-4111-8111-111111111111';

function mockSb(writes, { failCrmNotes = false } = {}) {
  const chain = (table) => ({
    select: () => chain(table),
    eq: () => chain(table),
    maybeSingle: async () => ({ data: null }),
    upsert: (row) => { writes.push({ table, op: 'upsert', row }); return { select: () => ({ maybeSingle: async () => ({ data: row }) }) }; },
    insert: (row) => {
      if (failCrmNotes && table === 'crm_notes') throw new Error('no crm_notes table');
      writes.push({ table, op: 'insert', row });
      return { select: () => ({ single: async () => ({ data: { id: 'm1', created_at: 'now' }, error: null }) }) };
    },
  });
  return { from: (t) => chain(t) };
}

const event = (from, content) => ({
  website_id: 'site', event: from === 'operator' ? 'message:received' : 'message:send',
  data: { website_id: 'site', session_id: 's1', from, type: 'text', content, fingerprint: `fp-${content}`, data: { account_company_id: companyId } },
});

test('a routed visitor message mirrors into crm_notes as a chat note', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const writes = [];
  const res = await handleCrispEvent(mockSb(writes), {}, event('user', 'Need a quote'));
  assert.equal(res.routed, true);
  const note = writes.find((w) => w.table === 'crm_notes');
  assert.ok(note, 'crm_notes insert fired');
  assert.equal(note.row.kind, 'chat');
  assert.equal(note.row.subject_type, 'company');
  assert.equal(note.row.subject_id, companyId);
  assert.equal(note.row.body, 'Need a quote');
  assert.equal(note.row.created_by, 'crisp:visitor');
});

test('operator messages log as crisp:operator', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const writes = [];
  await handleCrispEvent(mockSb(writes), {}, event('operator', 'We can help'));
  assert.equal(writes.find((w) => w.table === 'crm_notes')?.row.created_by, 'crisp:operator');
});

test('a crm_notes failure never breaks routing (best-effort mirror)', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const writes = [];
  const res = await handleCrispEvent(mockSb(writes, { failCrmNotes: true }), {}, event('user', 'hi'));
  assert.equal(res.routed, true);
  assert.ok(writes.find((w) => w.table === 'messages'), 'message still landed');
});

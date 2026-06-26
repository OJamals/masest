import assert from 'node:assert/strict';
import test from 'node:test';

const companyId = '11111111-1111-4111-8111-111111111111';

// Filter-aware mock: the pending-reply lookup uses is(external_message_id, null);
// alreadySynced uses eq(external_message_id, ...). Distinguish on that.
function makeSb({ pending }) {
  const writes = [];
  const chain = (table) => {
    const isF = [];
    const c = {
      select: () => c, eq: () => c, in: () => c, gte: () => c, order: () => c, limit: () => c,
      is: (k) => { isF.push(k); return c; },
      maybeSingle: async () => {
        if (table === 'messages') return { data: isF.includes('external_message_id') ? pending : null };
        return { data: null };
      },
      upsert: (row) => { writes.push({ table, op: 'upsert', row }); return { select: () => ({ maybeSingle: async () => ({ data: row }) }) }; },
      insert: (row) => { writes.push({ table, op: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: 'm1', created_at: 'now' }, error: null }) }) }; },
      update: (row) => { writes.push({ table, op: 'update', row }); return { eq: () => ({}) }; },
    };
    return c;
  };
  return { sb: { from: chain }, writes };
}

const operatorEvent = (content) => ({
  website_id: 'site', event: 'message:send',
  data: { website_id: 'site', session_id: 's1', from: 'operator', type: 'text', content, fingerprint: `fp-${content}`, data: { account_company_id: companyId } },
});

test('operator echo claims a matching pending dashboard reply (no duplicate insert)', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ pending: { id: 'pending-1' } });
  const res = await handleCrispEvent(sb, {}, operatorEvent('Thanks, shipping today'));
  assert.equal(res.routed, true);
  assert.equal(res.claimed, 'pending-1');
  assert.ok(writes.find((w) => w.table === 'messages' && w.op === 'update'), 'claimed via update');
  assert.ok(!writes.find((w) => w.table === 'messages' && w.op === 'insert'), 'no duplicate insert');
});

test('operator message typed directly in Crisp (no pending) inserts normally', async () => {
  const { handleCrispEvent } = await import('../functions/api/crisp/webhook.js');
  const { sb, writes } = makeSb({ pending: null });
  const res = await handleCrispEvent(sb, {}, operatorEvent('Typed in Crisp'));
  assert.equal(res.routed, true);
  assert.ok(writes.find((w) => w.table === 'messages' && w.op === 'insert'), 'inserted');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrmContactModule } from '../functions/_lib/crm-contacts.js';

function mergeStore({ failBackfill = false } = {}) {
  const calls = [];
  const contacts = [
    { id: 1, company_id: 'company-1', name: 'Duplicate', email: 'buyer@example.com' },
    { id: 2, company_id: 'company-1', name: 'Survivor', email: null },
  ];
  return {
    calls,
    async contactsByIds() {
      return contacts;
    },
    async moveQuoteContact() {
      calls.push('move_quote');
    },
    async moveActivitySubject(kind) {
      calls.push(`move_${kind}`);
    },
    async retireContact() {
      calls.push('retire_duplicate');
    },
    async updateContact() {
      calls.push('backfill_survivor');
      if (failBackfill) throw new Error('duplicate key value violates unique constraint');
    },
    async contact(id) {
      return contacts.find((contact) => contact.id === id);
    },
  };
}

test('merge retires the duplicate before backfilling the survivor', async () => {
  const store = mergeStore();
  const result = await createCrmContactModule({ store }).merge({ fromId: 1, intoId: 2 });

  assert.equal(result.ok, true);
  assert.ok(store.calls.indexOf('retire_duplicate') < store.calls.indexOf('backfill_survivor'));
});

test('merge backfill checks the write result (no swallowed unique-conflict)', async () => {
  const store = mergeStore({ failBackfill: true });
  const result = await createCrmContactModule({ store }).merge({ fromId: 1, intoId: 2 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'storage_error');
  assert.match(result.message, /duplicate key value/);
});

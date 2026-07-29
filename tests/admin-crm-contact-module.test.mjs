import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrmContactModule } from '../functions/_lib/crm-contacts.js';

function memoryContactStore({
  contacts = [],
  quotes = [],
  notes = [],
  tasks = [],
} = {}) {
  const state = {
    contacts: structuredClone(contacts),
    quotes: structuredClone(quotes),
    notes: structuredClone(notes),
    tasks: structuredClone(tasks),
  };

  return {
    state,
    async activeEmails(companyId) {
      return state.contacts
        .filter((contact) => contact.company_id === companyId && !contact.deleted_at && contact.email)
        .map((contact) => contact.email);
    },
    async insertContacts(rows) {
      const inserted = rows.map((row, index) => ({ id: 100 + index, ...row }));
      state.contacts.push(...inserted);
      return inserted;
    },
    async contactsByIds(ids) {
      return state.contacts.filter((contact) => ids.includes(contact.id) && !contact.deleted_at);
    },
    async moveQuoteContact(fromId, intoId) {
      state.quotes
        .filter((quote) => quote.contact_id === fromId)
        .forEach((quote) => { quote.contact_id = intoId; });
    },
    async moveActivitySubject(kind, fromId, intoId) {
      state[kind]
        .filter((entry) => entry.subject_type === 'contact' && entry.subject_id === String(fromId))
        .forEach((entry) => { entry.subject_id = String(intoId); });
    },
    async retireContact(id, retiredAt) {
      const contact = state.contacts.find((entry) => entry.id === id);
      if (contact) contact.deleted_at = retiredAt;
    },
    async updateContact(id, patch) {
      const contact = state.contacts.find((entry) => entry.id === id);
      if (contact) Object.assign(contact, patch);
    },
    async contact(id) {
      return state.contacts.find((entry) => entry.id === id) || null;
    },
  };
}

test('CRM Contact module merges identity state through one interface', async () => {
  const store = memoryContactStore({
    contacts: [
      { id: 1, company_id: 'company-1', name: 'Duplicate', email: 'buyer@example.com', phone: '555-0100' },
      { id: 2, company_id: 'company-1', name: 'Survivor', email: null, phone: null },
    ],
    quotes: [{ id: 'quote-1', contact_id: 1 }],
    notes: [{ id: 10, subject_type: 'contact', subject_id: '1' }],
    tasks: [{ id: 11, subject_type: 'contact', subject_id: '1' }],
  });
  const audits = [];
  const contacts = createCrmContactModule({
    store,
    audit: async (entry) => { audits.push(entry); },
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  });

  const result = await contacts.merge({ fromId: 1, intoId: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.contact.email, 'buyer@example.com');
  assert.equal(result.contact.phone, '555-0100');
  assert.equal(store.state.contacts.find((entry) => entry.id === 1).deleted_at, '2026-07-29T12:00:00.000Z');
  assert.equal(store.state.quotes[0].contact_id, 2);
  assert.equal(store.state.notes[0].subject_id, '2');
  assert.equal(store.state.tasks[0].subject_id, '2');
  assert.deepEqual(audits, [{
    action: 'crm.contact_merge',
    targetType: 'company',
    targetId: 'company-1',
    detail: { from: 1, into: 2 },
  }]);
});

test('CRM Contact module imports CSV with existing and in-file duplicate protection', async () => {
  const store = memoryContactStore({
    contacts: [{ id: 1, company_id: 'company-1', name: 'Existing', email: 'existing@example.com' }],
  });
  const audits = [];
  const contacts = createCrmContactModule({
    store,
    audit: async (entry) => { audits.push(entry); },
  });

  const result = await contacts.importCsv({
    companyId: 'company-1',
    actor: 'owner@masest.com',
    csv: [
      'name,email,role',
      'Existing Again,existing@example.com,procurement',
      'New Buyer,new@example.com,plant_manager',
      'New Buyer Duplicate,new@example.com,engineering',
    ].join('\n'),
  });

  assert.deepEqual(result, {
    ok: true,
    inserted: 1,
    skipped: 2,
    skipped_duplicates: 2,
    errors: [
      { row: 3, error: 'duplicate_email', email: 'new@example.com' },
      { row: 1, error: 'duplicate_email', email: 'existing@example.com' },
    ],
  });
  assert.equal(store.state.contacts.length, 2);
  assert.equal(store.state.contacts[1].email, 'new@example.com');
  assert.deepEqual(audits, [{
    action: 'crm.contact_import',
    targetType: 'company',
    targetId: 'company-1',
    detail: { inserted: 1, skipped: 2, skipped_duplicates: 2 },
  }]);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  NEWSLETTER_NOTE_ACTOR,
  linkNewsletterSignupToContacts,
  newsletterNoteBody,
} from '../functions/_lib/newsletter-crm-link.js';

// In-memory double for the Supabase query builder calls the linker makes: select, is, eq,
// ilike (with Postgres LIKE escaping), limit, and insert. Builders are thenables, like the
// real client, so the code under test awaits them the same way.
function likeToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '%') { out += '.*'; continue; }
    if (ch === '_') { out += '.'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

function fakeSb(db, { failInsert = false, failContacts = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let limit = Infinity;
      let inserted = null;
      const builder = {
        select() { return builder; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        ilike(column, pattern) { const re = likeToRegExp(pattern); filters.push((row) => row[column] != null && re.test(row[column])); return builder; },
        limit(n) { limit = n; return builder; },
        insert(row) { inserted = row; return builder; },
        then(resolve, reject) {
          calls.push({ table, inserted: Boolean(inserted) });
          if (inserted) {
            if (failInsert) return Promise.resolve({ error: { message: 'insert failed' } }).then(resolve, reject);
            db[table].push({ id: db[table].length + 1, deleted_at: null, ...inserted });
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          if (table === 'crm_contacts' && failContacts) return Promise.resolve({ data: null, error: { message: 'contacts failed' } }).then(resolve, reject);
          const data = (db[table] || []).filter((row) => filters.every((f) => f(row))).slice(0, limit);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const contact = (overrides) => ({ id: 'c1', company_id: 'co-1', email: 'Avery@Acme.test', deleted_at: null, ...overrides });

test('the note says where the signup came from and what it asked for', () => {
  assert.equal(
    newsletterNoteBody({ page_title: 'Marine cleaning', source_path: '/industries/marine', industry: 'Marine', document: 'MultiWash SDS' }),
    'Subscribed to the MASEST newsletter from Marine cleaning.\nPage: /industries/marine\nIndustry: Marine\nRequested document: MultiWash SDS',
  );
  assert.equal(newsletterNoteBody({ source_path: '/blog' }), 'Subscribed to the MASEST newsletter from /blog.');
  assert.equal(newsletterNoteBody({}), 'Subscribed to the MASEST newsletter.');
});

test('a signup matching a known contact adds one note to that contact, whatever the email case', async () => {
  const db = { crm_contacts: [contact()], crm_notes: [] };
  const result = await linkNewsletterSignupToContacts(fakeSb(db), { email: '  avery@ACME.test ', properties: { page_title: 'Home' } });

  assert.deepEqual(result, { linked: 1, skipped: 0 });
  assert.equal(db.crm_notes.length, 1);
  const note = db.crm_notes[0];
  assert.equal(note.subject_type, 'contact');
  assert.equal(note.subject_id, 'c1');
  assert.equal(note.kind, 'note');
  assert.equal(note.created_by, NEWSLETTER_NOTE_ACTOR);
  assert.equal(note.body, 'Subscribed to the MASEST newsletter from Home.');
});

test('a stranger creates nothing', async () => {
  const db = { crm_contacts: [contact()], crm_notes: [] };
  const result = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'someone.else@example.test' });
  assert.deepEqual(result, { linked: 0, skipped: 0 });
  assert.equal(db.crm_notes.length, 0);
});

test('retired contacts are not linked', async () => {
  const db = { crm_contacts: [contact({ deleted_at: '2026-08-01T00:00:00Z' })], crm_notes: [] };
  const result = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'avery@acme.test' });
  assert.deepEqual(result, { linked: 0, skipped: 0 });
});

test('the same email at two companies links each company contact', async () => {
  // crm_contacts_company_email_uniq is per company, so one person can be a contact twice.
  const db = { crm_contacts: [contact(), contact({ id: 'c2', company_id: 'co-2' })], crm_notes: [] };
  const result = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'avery@acme.test' });
  assert.deepEqual(result, { linked: 2, skipped: 0 });
  assert.deepEqual(db.crm_notes.map((note) => note.subject_id).sort(), ['c1', 'c2']);
});

test('resubscribing does not stack a second note, but a staff note does not count as one', async () => {
  const db = {
    crm_contacts: [contact()],
    crm_notes: [{ id: 1, subject_type: 'contact', subject_id: 'c1', created_by: 'staff@masest.test', body: 'Called about pails', deleted_at: null }],
  };
  const first = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'avery@acme.test' });
  assert.deepEqual(first, { linked: 1, skipped: 0 }, 'an unrelated staff note does not block the link');
  const again = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'avery@acme.test', properties: { page_title: 'Another page' } });
  assert.deepEqual(again, { linked: 0, skipped: 1 });
  assert.equal(db.crm_notes.filter((note) => note.created_by === NEWSLETTER_NOTE_ACTOR).length, 1);
});

test('LIKE metacharacters in an email are matched literally', async () => {
  // Unescaped, "a_b" would also match "axb" and link the wrong person.
  const db = { crm_contacts: [contact({ id: 'wrong', email: 'axb@acme.test' })], crm_notes: [] };
  const result = await linkNewsletterSignupToContacts(fakeSb(db), { email: 'a_b@acme.test' });
  assert.deepEqual(result, { linked: 0, skipped: 0 });
});

test('no email, no queries', async () => {
  const sb = fakeSb({ crm_contacts: [contact()], crm_notes: [] });
  assert.deepEqual(await linkNewsletterSignupToContacts(sb, { email: '   ' }), { linked: 0, skipped: 0 });
  assert.equal(sb.calls.length, 0);
});

test('database errors surface to the caller, which decides not to fail the signup', async () => {
  await assert.rejects(linkNewsletterSignupToContacts(fakeSb({ crm_contacts: [contact()], crm_notes: [] }, { failInsert: true }), { email: 'avery@acme.test' }));
  await assert.rejects(linkNewsletterSignupToContacts(fakeSb({ crm_contacts: [], crm_notes: [] }, { failContacts: true }), { email: 'avery@acme.test' }));
});

test('the signup endpoint links known contacts only after the subscription succeeds, and never fails on it', () => {
  const source = readFileSync(new URL('../functions/api/newsletter.js', import.meta.url), 'utf8');
  const honeypot = source.indexOf('if (body.company) return json(200');
  const preference = source.indexOf('await setMarketingPreference(');
  const preferenceFailure = source.indexOf('if (!r.ok) return json(503');
  const link = source.indexOf('await linkNewsletterSignupToContacts(adminClient(env), { email, properties })');
  const success = source.lastIndexOf('return json(200, { ok: true });');

  for (const [name, index] of Object.entries({ honeypot, preference, preferenceFailure, link, success })) {
    assert.notEqual(index, -1, `${name} must exist`);
  }
  assert.ok(honeypot < link, 'a honeypot submission never reaches the CRM');
  assert.ok(preference < link && preferenceFailure < link, 'nothing is linked unless the subscription was recorded');
  assert.ok(link < success, 'the link runs before the success response');

  const guarded = source.slice(source.lastIndexOf('try {', link), source.indexOf('}', source.indexOf('catch (error)', link)) + 1);
  assert.match(guarded, /try \{[\s\S]*linkNewsletterSignupToContacts[\s\S]*\} catch \(error\) \{/, 'a CRM failure is caught');
  assert.doesNotMatch(guarded, /console\.error\([^)]*email/, 'the log line must not carry the email');
});

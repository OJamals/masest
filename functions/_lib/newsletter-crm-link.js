// Links a newsletter signup to CRM contacts that already carry the same email.
//
// A signup holds an email and the page it came from; crm_contacts rows belong to a company.
// So a stranger is not a contact and creates nothing here, and the sales pipeline gets no
// unqualified rows. Only people staff already know gain a note on their timeline.
// crm_notes has accepted subject_type 'contact' since supabase/schema-crm-contact-subject.sql
// (live constraint crm_notes_subject_type_chk, verified 2026-09-13).
//
// One email can belong to contacts at several companies — the unique index is per company,
// crm_contacts_company_email_uniq on (company_id, lower(email)) — so each matching contact
// is linked. Notes are keyed on their author marker rather than their wording, so resubscribing
// never stacks a second note and a copy change cannot defeat that.
import { escapeLike, noteRow } from './crm.js';
import { contactEmailKey } from './crm-contacts.js';

export const NEWSLETTER_NOTE_ACTOR = 'newsletter_signup';
const MAX_LINKED_CONTACTS = 25;

export function newsletterNoteBody(properties = {}) {
  const where = properties.page_title || properties.source_page || properties.source_path || '';
  const lines = [`Subscribed to the MASEST newsletter${where ? ` from ${where}` : ''}.`];
  if (properties.source_path && properties.source_path !== where) lines.push(`Page: ${properties.source_path}`);
  if (properties.industry) lines.push(`Industry: ${properties.industry}`);
  if (properties.document) lines.push(`Requested document: ${properties.document}`);
  return lines.join('\n');
}

export async function linkNewsletterSignupToContacts(sb, { email, properties = {} } = {}) {
  const key = contactEmailKey(email);
  if (!sb || !key) return { linked: 0, skipped: 0 };

  // ilike with every LIKE metacharacter escaped is a case-insensitive exact match, which is
  // what the per-company unique index compares on.
  const { data: contacts, error } = await sb.from('crm_contacts')
    .select('id,company_id')
    .is('deleted_at', null)
    .ilike('email', escapeLike(key))
    .limit(MAX_LINKED_CONTACTS);
  if (error) throw error;

  let linked = 0;
  let skipped = 0;
  for (const contact of contacts || []) {
    const subjectId = String(contact.id);
    const { data: existing, error: existingError } = await sb.from('crm_notes')
      .select('id')
      .eq('subject_type', 'contact')
      .eq('subject_id', subjectId)
      .eq('created_by', NEWSLETTER_NOTE_ACTOR)
      .is('deleted_at', null)
      .limit(1);
    if (existingError) throw existingError;
    if (existing?.length) {
      skipped += 1;
      continue;
    }
    const built = noteRow({
      subject_type: 'contact',
      subject_id: subjectId,
      kind: 'note',
      body: newsletterNoteBody(properties),
      actor: NEWSLETTER_NOTE_ACTOR,
    });
    if (built.error) throw new Error(built.error);
    const { error: insertError } = await sb.from('crm_notes').insert(built.row);
    if (insertError) throw insertError;
    linked += 1;
  }
  return { linked, skipped };
}

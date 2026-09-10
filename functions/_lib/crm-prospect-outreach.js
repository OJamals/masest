export const OUTREACH_STATUSES = ['draft', 'approved', 'sent', 'replied', 'opted_out', 'archived'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_FIELDS = new Set([
  'organization_id', 'contact_id', 'recipient_email', 'subject', 'body_text',
  'compliance_basis', 'source_url',
]);
const TRANSITIONS = {
  approve: new Set(['draft']),
  sent: new Set(['approved']),
  replied: new Set(['sent']),
  opted_out: new Set(['draft', 'approved', 'sent', 'replied']),
  archive: new Set(['draft', 'approved', 'sent', 'replied', 'opted_out']),
};

const clean = (value) => String(value || '').trim();

function validSourceUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildOutreachDraft(input, staffId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'bad_request' };
  if (Object.keys(input).some((key) => !DRAFT_FIELDS.has(key))) return { error: 'unsupported_field' };
  const organizationId = clean(input.organization_id);
  const contactId = input.contact_id == null || input.contact_id === '' ? null : clean(input.contact_id);
  const recipientEmail = clean(input.recipient_email).toLowerCase();
  const subject = clean(input.subject);
  const bodyText = clean(input.body_text);
  const complianceBasis = clean(input.compliance_basis);
  const sourceUrl = clean(input.source_url);
  const createdBy = clean(staffId);

  if (!UUID_RE.test(organizationId)) return { error: 'invalid_organization_id' };
  if (contactId && !UUID_RE.test(contactId)) return { error: 'invalid_contact_id' };
  if (!EMAIL_RE.test(recipientEmail) || recipientEmail.length > 320) return { error: 'invalid_recipient_email' };
  if (!subject || subject.length > 180) return { error: 'invalid_subject' };
  if (!bodyText || bodyText.length > 8000) return { error: 'invalid_body' };
  if (complianceBasis.length > 1000) return { error: 'invalid_compliance_basis' };
  if (sourceUrl && (!validSourceUrl(sourceUrl) || sourceUrl.length > 1000)) return { error: 'invalid_source_url' };
  if (!createdBy || createdBy.length > 200) return { error: 'invalid_staff_id' };

  return {
    draft: {
      organization_id: organizationId,
      contact_id: contactId,
      recipient_email: recipientEmail,
      subject,
      body_text: bodyText,
      compliance_basis: complianceBasis || null,
      source_url: sourceUrl || null,
      status: 'draft',
      created_by: createdBy,
    },
  };
}

export function buildOutreachTransition(input, existing, staffId, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'bad_request' };
  if (Object.keys(input).some((key) => !['id', 'action'].includes(key))) return { error: 'unsupported_field' };
  const action = clean(input.action);
  const allowedFrom = TRANSITIONS[action];
  if (!allowedFrom) return { error: 'invalid_action' };
  if (!allowedFrom.has(existing?.status)) return { error: 'invalid_transition' };
  if (action === 'approve') {
    if (clean(existing.compliance_basis).length < 12 || !validSourceUrl(clean(existing.source_url))) {
      return { error: 'approval_evidence_required' };
    }
  }

  const timestamp = now.toISOString();
  const status = action === 'approve' ? 'approved' : action === 'archive' ? 'archived' : action;
  const patch = { status, updated_at: timestamp };
  if (action === 'approve') Object.assign(patch, { approved_by: clean(staffId), approved_at: timestamp });
  if (action === 'sent') patch.sent_at = timestamp;
  if (action === 'replied') patch.replied_at = timestamp;
  if (action === 'opted_out') patch.opted_out_at = timestamp;
  if (action === 'archive') patch.archived_at = timestamp;
  return { patch };
}

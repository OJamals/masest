// Staff-only manual outreach workspace. It stores review state and opens a
// user's email client; no delivery provider is called from this endpoint.
import {
  adminClient,
  internalServerError,
  json,
  requireStaff,
} from '../../../_lib/supabase.js';
import { staffCan } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../../_lib/request-body.js';
import { isMissingProspectSchema } from '../../../_lib/crm-prospects.js';
import {
  buildOutreachDraft,
  buildOutreachTransition,
} from '../../../_lib/crm-prospect-outreach.js';

const OUTREACH_REQUEST_MAX_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECT = [
  'id', 'organization_id', 'contact_id', 'recipient_email', 'subject', 'body_text',
  'compliance_basis', 'source_url', 'status', 'created_by', 'approved_by',
  'approved_at', 'sent_at', 'replied_at', 'opted_out_at', 'archived_at',
  'retention_review_at', 'created_at', 'updated_at',
].join(',');

async function bodyFrom(request) {
  try {
    const body = await readBoundedJson(request, OUTREACH_REQUEST_MAX_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad_request' };
    return { body };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return { error: 'request_too_large' };
    return { error: 'bad_request' };
  }
}

function blocked(record) {
  return record?.marketing_consent === 'opted_out' || record?.outreach_status === 'blocked';
}

function resolvedEmail(recipient) {
  return String(recipient.contact?.email || recipient.organization?.general_email || '').trim().toLowerCase();
}

async function resolveRecipient(sb, organizationId, contactId) {
  const { data: organization, error } = await sb.from('prospect_organizations')
    .select('id,general_email,marketing_consent,outreach_status').eq('id', organizationId)
    .is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!organization) return { error: 'organization_not_found' };
  let contact = null;
  if (contactId) {
    const result = await sb.from('prospect_contacts')
      .select('id,organization_id,email,marketing_consent,outreach_status,needs_verification')
      .eq('id', contactId).eq('organization_id', organizationId)
      .is('deleted_at', null).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return { error: 'contact_not_found' };
    contact = result.data;
  }
  return { organization, contact };
}

async function recordOptOut(sb, draft, now) {
  const patch = {
    marketing_consent: 'opted_out',
    marketing_consent_source: 'manual_outreach_reply',
    marketing_consent_at: now,
    outreach_status: 'blocked',
    outreach_basis: 'Recipient opted out of direct outreach.',
    outreach_reviewed_at: now,
    updated_at: now,
  };
  if (draft.contact_id) {
    const { error } = await sb.from('prospect_contacts').update(patch).eq('id', draft.contact_id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('prospect_organizations').update(patch).eq('id', draft.organization_id);
    if (error) throw error;
  }
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCan(role, 'prospect.write')) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'POST') {
    const parsed = await bodyFrom(request);
    if (parsed.error) return json(parsed.error === 'request_too_large' ? 413 : 400, { error: parsed.error });
    const built = buildOutreachDraft(parsed.body, user.id || user.email);
    if (built.error) return json(400, { error: built.error });
    try {
      const recipient = await resolveRecipient(sb, built.draft.organization_id, built.draft.contact_id);
      if (recipient.error) return json(404, { error: recipient.error });
      if (blocked(recipient.organization) || blocked(recipient.contact)) return json(409, { error: 'outreach_blocked' });
      if (recipient.contact?.needs_verification) return json(409, { error: 'recipient_verification_required' });
      const expectedEmail = resolvedEmail(recipient);
      if (!expectedEmail || expectedEmail !== built.draft.recipient_email) return json(400, { error: 'recipient_mismatch' });
      const { data, error } = await sb.from('prospect_outreach_drafts')
        .insert(built.draft).select('id,organization_id,contact_id,status').single();
      if (error) {
        if (isMissingProspectSchema(error)) return json(409, { error: 'migration_required' });
        throw error;
      }
      await recordAudit(sb, {
        user,
        action: 'crm.prospect_outreach_draft_create',
        targetType: 'prospect_outreach_draft',
        targetId: data.id,
        detail: { organization_id: data.organization_id, contact_id: data.contact_id },
      });
      return json(201, { ok: true, draft: data });
    } catch (error) {
      return internalServerError('admin.crm.prospect_outreach.post', error);
    }
  }

  if (request.method === 'PATCH') {
    const parsed = await bodyFrom(request);
    if (parsed.error) return json(parsed.error === 'request_too_large' ? 413 : 400, { error: parsed.error });
    const id = String(parsed.body.id || '').trim();
    if (!UUID_RE.test(id)) return json(400, { error: 'invalid_id' });
    try {
      const { data: existing, error: getError } = await sb.from('prospect_outreach_drafts')
        .select(SELECT).eq('id', id).maybeSingle();
      if (getError) {
        if (isMissingProspectSchema(getError)) return json(409, { error: 'migration_required' });
        throw getError;
      }
      if (!existing) return json(404, { error: 'not_found' });
      if (parsed.body.action === 'approve') {
        const recipient = await resolveRecipient(sb, existing.organization_id, existing.contact_id);
        if (recipient.error) return json(404, { error: recipient.error });
        if (blocked(recipient.organization) || blocked(recipient.contact)) return json(409, { error: 'outreach_blocked' });
        if (recipient.contact?.needs_verification) return json(409, { error: 'recipient_verification_required' });
        if (resolvedEmail(recipient) !== existing.recipient_email) return json(409, { error: 'recipient_mismatch' });
      }
      const now = new Date();
      const built = buildOutreachTransition(parsed.body, existing, user.id || user.email, now);
      if (built.error) return json(400, { error: built.error });
      if (parsed.body.action === 'opted_out') await recordOptOut(sb, existing, now.toISOString());
      const { data, error } = await sb.from('prospect_outreach_drafts')
        .update(built.patch).eq('id', id).select('id,status,updated_at').single();
      if (error) throw error;
      await recordAudit(sb, {
        user,
        action: `crm.prospect_outreach_${parsed.body.action}`,
        targetType: 'prospect_outreach_draft',
        targetId: id,
        detail: { organization_id: existing.organization_id, contact_id: existing.contact_id },
      });
      return json(200, { ok: true, draft: data });
    } catch (error) {
      return internalServerError('admin.crm.prospect_outreach.patch', error);
    }
  }

  return json(405, { error: 'method_not_allowed' });
}

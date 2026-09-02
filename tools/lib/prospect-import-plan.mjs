import { createHash } from 'node:crypto';

const SHA256_RE = /^[0-9a-f]{64}$/;
const UNKNOWN_CONSENT = 'Unknown — no bulk marketing';
const RECORD_TYPES = new Set(['Organization', 'Person']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function text(value, max, field) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`${field}_too_long`);
  return normalized;
}

function email(value) {
  const normalized = text(value, 320, 'email');
  return normalized ? normalized.toLowerCase() : null;
}

function normalizedCompany(row) {
  const value = text(row.normalized_company || row.company, 200, 'normalized_company');
  if (!value) throw new Error('company_required');
  return value.toLowerCase();
}

function first(rows, key, max) {
  for (const row of rows) {
    const value = text(row[key], max, key);
    if (value) return value;
  }
  return null;
}

function mostFrequent(rows, key, max) {
  const counts = new Map();
  for (const row of rows) {
    const value = text(row[key], max, key);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function retentionDate(generatedOn) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(generatedOn || ''))) throw new Error('invalid_generated_on');
  const date = new Date(`${generatedOn}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== generatedOn) {
    throw new Error('invalid_generated_on');
  }
  date.setUTCDate(date.getUTCDate() + 365);
  return date.toISOString().slice(0, 10);
}

function organizationIdentity(normalizedName) {
  return sha256(`prospect-organization\0${normalizedName}`);
}

function contactIdentity(row, organizationKey) {
  const normalizedEmail = email(row.email);
  const normalizedPhone = String(row.phone || '').replace(/\D/g, '');
  const normalizedName = text(row.contact_name, 200, 'contact_name')?.toLowerCase();
  if (!normalizedName) throw new Error('contact_name_required');
  const discriminator = normalizedEmail
    ? `email:${normalizedEmail}`
    : `name:${normalizedName}:phone:${normalizedPhone}:title:${String(row.title || '').trim().toLowerCase()}`;
  return sha256(`prospect-contact\0${organizationKey}\0${discriminator}`);
}

function validateSource(source, workbookSha256) {
  if (!SHA256_RE.test(workbookSha256 || '')) throw new Error('invalid_workbook_sha256');
  if (!source || !Array.isArray(source.master)) throw new Error('invalid_contact_source');
  if (!String(source.policy?.consent || '').toLowerCase().includes('blocks bulk marketing')) {
    throw new Error('prospect_consent_policy_missing');
  }
  if (Number(source.summary?.master_records) !== source.master.length) {
    throw new Error('master_record_count_mismatch');
  }
}

export function buildProspectImportPlan(source, { workbookSha256 } = {}) {
  validateSource(source, workbookSha256);
  const seenMasterIds = new Set();
  const groups = new Map();

  for (const row of source.master) {
    const masterId = text(row.master_id, 80, 'master_id');
    if (!masterId) throw new Error('master_id_required');
    if (seenMasterIds.has(masterId)) throw new Error(`duplicate_master_id:${masterId}`);
    seenMasterIds.add(masterId);
    if (!RECORD_TYPES.has(row.record_type)) throw new Error(`invalid_record_type:${row.record_type}`);
    if (row.marketing_consent !== UNKNOWN_CONSENT || row.suppressed !== 'Unknown') {
      throw new Error(`prospect_consent_not_unknown:${masterId}`);
    }
    const normalizedName = normalizedCompany(row);
    const list = groups.get(normalizedName) || [];
    list.push(row);
    groups.set(normalizedName, list);
  }

  if (Number(source.summary?.unique_companies) !== groups.size) {
    throw new Error('organization_count_mismatch');
  }

  const organizations = [];
  const contacts = [];
  const sourceRecords = [];
  const contactKeys = new Set();
  const reviewAt = retentionDate(source.generated_on);

  for (const [normalizedName, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...group].sort((a, b) => {
      const typeOrder = Number(b.record_type === 'Organization') - Number(a.record_type === 'Organization');
      return typeOrder || String(a.master_id).localeCompare(String(b.master_id));
    });
    const organizationRows = ordered.filter((row) => row.record_type === 'Organization');
    const preferred = organizationRows.length ? [...organizationRows, ...ordered.filter((row) => row.record_type !== 'Organization')] : ordered;
    const identityKey = organizationIdentity(normalizedName);
    const name = first(preferred, 'company', 200);
    if (!name) throw new Error(`organization_name_required:${normalizedName}`);

    organizations.push({
      identityKey,
      name,
      normalizedName,
      segment: mostFrequent(ordered, 'segment', 120),
      address: first(preferred, 'address', 300),
      city: first(preferred, 'city', 120),
      state: first(preferred, 'state', 64),
      postalCode: first(preferred, 'postal_code', 32),
      location: first(preferred, 'location', 160),
      generalEmail: organizationRows.length ? email(first(organizationRows, 'email', 320)) : null,
      phone: first(preferred, 'phone', 64),
      website: first(preferred, 'website', 512),
      linkedin: first(preferred, 'linkedin', 512),
      status: 'new',
      priority: 'unassigned',
      marketingConsent: 'unknown',
      outreachStatus: 'unreviewed',
      retentionReviewAt: reviewAt,
    });

    for (const row of ordered) {
      let identityKeyForContact = null;
      if (row.record_type === 'Person') {
        identityKeyForContact = contactIdentity(row, identityKey);
        if (contactKeys.has(identityKeyForContact)) throw new Error(`duplicate_contact_identity:${row.master_id}`);
        contactKeys.add(identityKeyForContact);
        contacts.push({
          organizationIdentityKey: identityKey,
          identityKey: identityKeyForContact,
          name: text(row.contact_name, 200, 'contact_name'),
          title: text(row.title, 160, 'title'),
          email: email(row.email),
          phone: text(row.phone, 64, 'phone'),
          linkedin: text(row.linkedin, 512, 'linkedin'),
          marketingConsent: 'unknown',
          outreachStatus: 'unreviewed',
          needsVerification: String(row.verify_flag || '').trim().toUpperCase() === 'Y',
          retentionReviewAt: reviewAt,
        });
      }
      sourceRecords.push({
        sourceRecordId: text(row.master_id, 80, 'master_id'),
        recordType: row.record_type,
        organizationIdentityKey: identityKey,
        contactIdentityKey: identityKeyForContact,
        sourceIds: unique(Array.isArray(row.source_ids) ? row.source_ids.map((value) => text(value, 120, 'source_id')) : []),
      });
    }
  }

  organizations.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  contacts.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  sourceRecords.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const manifestSha256 = sha256(JSON.stringify({ organizations, contacts, sourceRecords }));

  return {
    batch: {
      sourceSha256: workbookSha256,
      manifestSha256,
      sourceGeneratedOn: source.generated_on,
      sourceRecordCount: sourceRecords.length,
      organizationCount: organizations.length,
      contactCount: contacts.length,
    },
    organizations,
    contacts,
    sourceRecords,
  };
}

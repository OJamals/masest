export const PROSPECT_STATUSES = ['new', 'researching', 'qualified', 'converted', 'archived'];
export const PROSPECT_PRIORITIES = ['unassigned', 'low', 'normal', 'high'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PATCH_FIELDS = new Set(['id', 'status', 'priority', 'linked_company_id', 'retention_review_at']);

function isIsoDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

export function prospectListParams(searchParams) {
  const q = String(searchParams.get('q') || '').trim().slice(0, 120);
  const status = String(searchParams.get('status') || '').trim();
  const priority = String(searchParams.get('priority') || '').trim();
  if (q && q.length < 2) return { error: 'query_too_short' };
  if (status && !PROSPECT_STATUSES.includes(status)) return { error: 'invalid_status' };
  if (priority && !PROSPECT_PRIORITIES.includes(priority)) return { error: 'invalid_priority' };

  const rawLimit = Number.parseInt(searchParams.get('limit') || '25', 10);
  const rawOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
  return {
    q,
    status: status || null,
    priority: priority || null,
    limit: Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 25)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
  };
}

export function prospectPatch(input, existing = {}, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'bad_request' };
  if (Object.keys(input).some((key) => !PATCH_FIELDS.has(key))) return { error: 'unsupported_field' };
  const patch = {};

  if (own(input, 'status')) {
    if (!PROSPECT_STATUSES.includes(input.status)) return { error: 'invalid_status' };
    patch.status = input.status;
  }
  if (own(input, 'priority')) {
    if (!PROSPECT_PRIORITIES.includes(input.priority)) return { error: 'invalid_priority' };
    patch.priority = input.priority;
  }
  if (own(input, 'linked_company_id')) {
    const companyId = input.linked_company_id == null || input.linked_company_id === ''
      ? null
      : String(input.linked_company_id).trim();
    if (companyId && !UUID_RE.test(companyId)) return { error: 'invalid_company_id' };
    patch.linked_company_id = companyId;
  }
  if (own(input, 'retention_review_at')) {
    const date = String(input.retention_review_at || '').trim();
    if (!isIsoDate(date)) return { error: 'invalid_retention_date' };
    patch.retention_review_at = date;
  }

  if (!Object.keys(patch).length) return { error: 'no_changes' };
  const nextStatus = patch.status || existing.status || 'new';
  const nextCompanyId = own(patch, 'linked_company_id') ? patch.linked_company_id : existing.linked_company_id;
  if (nextStatus === 'converted' && !nextCompanyId) return { error: 'linked_company_required' };
  patch.updated_at = now.toISOString();
  return { patch };
}

export function isMissingProspectSchema(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const prospectTable = /prospect_(?:import_batches|organizations|contacts|source_records)/i.test(text);
  const missing = ['42P01', 'PGRST205'].includes(String(error?.code || '').toUpperCase())
    || /does not exist|could not find the table|schema cache/i.test(text);
  return prospectTable && missing;
}

export function safeProspectSearch(value) {
  return String(value || '').replace(/[(),]/g, ' ').trim();
}

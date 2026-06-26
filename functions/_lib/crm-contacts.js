// Pure CRM helpers (slice 4): contact-level records keyed to a company. No I/O —
// route handlers pass input in and get a normalized row / patch out, so this is
// unit-testable against fake clients. Mirrors functions/_lib/crm.js.

export const CONTACT_ROLES = [
  'procurement', 'plant_manager', 'maintenance', 'engineering',
  'operations', 'accounts_payable', 'executive', 'other',
];

export const ROLE_LABELS = {
  procurement: 'Procurement',
  plant_manager: 'Plant Manager',
  maintenance: 'Maintenance',
  engineering: 'Engineering',
  operations: 'Operations',
  accounts_payable: 'Accounts Payable',
  executive: 'Executive',
  other: 'Other',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validRole(role) {
  return CONTACT_ROLES.includes(String(role));
}

const trimCap = (v, n) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, n) : null;
};

// Build an insert row from raw input. Returns { row } or { error }.
export function contactRow({ company_id, name, role, title, email, phone, is_primary, notes, actor } = {}) {
  const cid = String(company_id ?? '').trim();
  if (!cid) return { error: 'company_required' };
  const nm = String(name ?? '').trim();
  if (!nm) return { error: 'name_required' };
  const mail = String(email ?? '').trim();
  if (mail && !EMAIL_RE.test(mail)) return { error: 'invalid_email' };
  return {
    row: {
      company_id: cid,
      name: nm.slice(0, 200),
      role: validRole(role) ? role : 'other',
      title: trimCap(title, 160),
      email: mail ? mail.slice(0, 200) : null,
      phone: trimCap(phone, 60),
      is_primary: is_primary === true || is_primary === 'true',
      notes: trimCap(notes, 2000),
      created_by: actor || null,
    },
  };
}

// Build a partial update patch from provided keys only. Returns { patch } or { error }.
// `now` is injected so updated_at is deterministic in tests.
export function contactPatch({ name, role, title, email, phone, is_primary, notes } = {}, now) {
  const patch = {};
  if (name !== undefined) {
    const nm = String(name ?? '').trim();
    if (!nm) return { error: 'name_required' };
    patch.name = nm.slice(0, 200);
  }
  if (role !== undefined) patch.role = validRole(role) ? role : 'other';
  if (title !== undefined) patch.title = trimCap(title, 160);
  if (email !== undefined) {
    const mail = String(email ?? '').trim();
    if (mail && !EMAIL_RE.test(mail)) return { error: 'invalid_email' };
    patch.email = mail ? mail.slice(0, 200) : null;
  }
  if (phone !== undefined) patch.phone = trimCap(phone, 60);
  if (is_primary !== undefined) patch.is_primary = is_primary === true || is_primary === 'true';
  if (notes !== undefined) patch.notes = trimCap(notes, 2000);
  patch.updated_at = (now || new Date()).toISOString();
  return { patch };
}

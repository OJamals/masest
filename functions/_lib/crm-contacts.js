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

export function contactEmailKey(email) {
  return String(email ?? '').trim().toLowerCase();
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

// When merging a duplicate into a survivor, backfill ONLY the survivor's blank
// title/email/phone from the duplicate (never overwrite a value the survivor has).
// Pure — returns the patch of fields to fill (possibly empty).
export function mergeFields(survivor = {}, loser = {}) {
  const blank = (v) => v === null || v === undefined || String(v).trim() === '';
  const out = {};
  for (const k of ['title', 'email', 'phone']) {
    if (blank(survivor[k]) && !blank(loser[k])) out[k] = loser[k];
  }
  return out;
}

const CSV_COLS = ['name', 'role', 'title', 'email', 'phone'];

// Split one CSV line, honoring double-quoted fields with embedded commas + "" escapes.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Parse a contacts CSV into row objects {name,role,title,email,phone}. Detects a header
// row (any recognized column name) and maps by it; otherwise treats columns positionally
// in CSV_COLS order. Rows without a name are dropped. Pure — unit-tested.
export function parseContactsCsv(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const first = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  const hasHeader = first.some((c) => CSV_COLS.includes(c));
  const map = hasHeader ? first.map((c) => (CSV_COLS.includes(c) ? c : null)) : CSV_COLS;
  const start = hasHeader ? 1 : 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    cells.forEach((val, idx) => { const key = map[idx]; if (key) row[key] = String(val).trim(); });
    if (row.name) out.push(row);
  }
  return out;
}

export function prepareContactImportRows(parsedRows = [], { companyId, actor, limit = 500 } = {}) {
  const rows = [];
  const entries = [];
  const errors = [];
  const seenEmailKeys = new Set();

  (parsedRows || []).slice(0, limit).forEach((raw, index) => {
    const rowNumber = index + 1;
    const built = contactRow({ ...raw, company_id: companyId, actor });
    if (built.error) {
      errors.push({ row: rowNumber, error: built.error });
      return;
    }

    const emailKey = contactEmailKey(built.row.email);
    if (emailKey && seenEmailKeys.has(emailKey)) {
      errors.push({ row: rowNumber, error: 'duplicate_email', email: emailKey });
      return;
    }

    if (emailKey) seenEmailKeys.add(emailKey);
    rows.push(built.row);
    entries.push({ rowNumber, row: built.row, emailKey });
  });

  return { rows, entries, errors, emailKeys: [...seenEmailKeys] };
}

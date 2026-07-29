// Pure CRM helpers (slice 4): contact-level records keyed to a company. No I/O —
// route handlers pass input in and get a normalized row / patch out, so this is
// unit-testable against local test clients. Mirrors functions/_lib/crm.js.

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

const CONTACT_SELECT = 'id,company_id,name,role,title,email,phone,is_primary,notes,created_by,created_at,updated_at';

function isMissingCrmContactsTable(error) {
  return /does not exist|relation|schema cache/i.test(error?.message || '');
}

function isCrmContactUniqueConflict(error) {
  return /crm_contacts_company_email_uniq|duplicate key value|23505/i.test([
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(' '));
}

function storageFailure(error) {
  return { ok: false, error: 'storage_error', message: error?.message || 'crm_contact_storage_failed' };
}

export function createCrmContactModule({
  store,
  audit = async () => {},
  now = () => new Date(),
} = {}) {
  if (!store) throw new Error('crm_contact_store_required');

  async function importCsv({ companyId, csv, actor } = {}) {
    const targetCompanyId = String(companyId || '').trim();
    if (!targetCompanyId) return { ok: false, error: 'company_required' };
    const parsed = parseContactsCsv(csv || '');
    if (!parsed.length) return { ok: false, error: 'no_rows' };

    const prepared = prepareContactImportRows(parsed, { companyId: targetCompanyId, actor });
    const errors = [...prepared.errors];
    let existingEmails;
    try {
      existingEmails = prepared.emailKeys.length ? await store.activeEmails(targetCompanyId) : [];
    } catch (error) {
      if (isMissingCrmContactsTable(error)) {
        return {
          ok: false,
          inserted: 0,
          skipped: errors.length,
          skipped_duplicates: errors.filter((entry) => entry.error === 'duplicate_email').length,
          errors: errors.slice(0, 10),
          needs_migration: true,
        };
      }
      return storageFailure(error);
    }

    const existingEmailKeys = new Set((existingEmails || []).map(contactEmailKey).filter(Boolean));
    const entries = prepared.entries.filter((entry) => {
      if (entry.emailKey && existingEmailKeys.has(entry.emailKey)) {
        errors.push({ row: entry.rowNumber, error: 'duplicate_email', email: entry.emailKey });
        return false;
      }
      return true;
    });
    const rows = entries.map((entry) => entry.row);
    const duplicateSkips = errors.filter((entry) => entry.error === 'duplicate_email').length;
    let inserted = 0;
    if (rows.length) {
      try {
        inserted = (await store.insertContacts(rows)).length;
      } catch (error) {
        if (isCrmContactUniqueConflict(error)) {
          return {
            ok: false,
            error: 'duplicate_email',
            message: 'One or more contacts already exist. Refresh and retry the import.',
          };
        }
        return storageFailure(error);
      }
    }

    await audit({
      action: 'crm.contact_import',
      targetType: 'company',
      targetId: targetCompanyId,
      detail: { inserted, skipped: errors.length, skipped_duplicates: duplicateSkips },
    });
    return {
      ok: true,
      inserted,
      skipped: errors.length,
      skipped_duplicates: duplicateSkips,
      errors: errors.slice(0, 10),
    };
  }

  async function merge({ fromId: rawFromId, intoId: rawIntoId } = {}) {
    const fromId = Number(rawFromId);
    const intoId = Number(rawIntoId);
    if (!fromId || !intoId || fromId === intoId) return { ok: false, error: 'invalid_merge' };

    let rows;
    try {
      rows = await store.contactsByIds([fromId, intoId]);
    } catch (error) {
      return storageFailure(error);
    }
    const from = (rows || []).find((contact) => contact.id === fromId);
    const into = (rows || []).find((contact) => contact.id === intoId);
    if (!from || !into) return { ok: false, error: 'not_found' };
    if (from.company_id !== into.company_id) return { ok: false, error: 'different_company' };

    try {
      await store.moveQuoteContact(fromId, intoId);
      await store.moveActivitySubject('notes', fromId, intoId);
      await store.moveActivitySubject('tasks', fromId, intoId);
      await store.retireContact(fromId, now().toISOString());
      const fill = mergeFields(into, from);
      if (Object.keys(fill).length) await store.updateContact(intoId, fill);
      const survivor = await store.contact(intoId);
      await audit({
        action: 'crm.contact_merge',
        targetType: 'company',
        targetId: into.company_id,
        detail: { from: fromId, into: intoId },
      });
      return { ok: true, contact: survivor };
    } catch (error) {
      return storageFailure(error);
    }
  }

  return { importCsv, merge };
}

export function createSupabaseCrmContactStore(sb) {
  const checked = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  return {
    async activeEmails(companyId) {
      const result = await sb.from('crm_contacts')
        .select('email')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .not('email', 'is', null)
        .limit(2000);
      return (checked(result) || []).map((contact) => contact.email);
    },
    async insertContacts(rows) {
      return checked(await sb.from('crm_contacts').insert(rows).select('id')) || [];
    },
    async contactsByIds(ids) {
      return checked(await sb.from('crm_contacts')
        .select('id,company_id,name,title,email,phone,is_primary')
        .in('id', ids)
        .is('deleted_at', null)) || [];
    },
    async moveQuoteContact(fromId, intoId) {
      checked(await sb.from('quotes').update({ contact_id: intoId }).eq('contact_id', fromId));
    },
    async moveActivitySubject(kind, fromId, intoId) {
      checked(await sb.from(`crm_${kind}`).update({ subject_id: String(intoId) })
        .eq('subject_type', 'contact')
        .eq('subject_id', String(fromId)));
    },
    async retireContact(id, retiredAt) {
      checked(await sb.from('crm_contacts').update({ deleted_at: retiredAt }).eq('id', id));
    },
    async updateContact(id, patch) {
      checked(await sb.from('crm_contacts').update(patch).eq('id', id));
    },
    async contact(id) {
      return checked(await sb.from('crm_contacts').select(CONTACT_SELECT).eq('id', id).single()) || null;
    },
  };
}

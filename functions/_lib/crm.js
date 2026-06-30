// Pure CRM helpers (slice 1): subject validation, row builders, task transitions,
// and timeline merge. No I/O — route handlers pass Supabase results in and get
// normalized data out, so this is unit-testable against fake clients. Mirrors the
// functions/_lib/quote-convert.js pattern.

// Escape LIKE/ILIKE metacharacters so a value is matched literally (Postgres uses
// backslash as the default LIKE escape char). Without this, %/_ in a company name or
// email act as wildcards and over-match. Pure.
export function escapeLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const SUBJECT_TYPES = ['company', 'quote', 'contact'];
export const NOTE_KINDS = ['note', 'call', 'email', 'meeting'];

export function validSubject(type, id) {
  return SUBJECT_TYPES.includes(String(type)) && String(id ?? '').trim().length > 0;
}

export function noteRow({ subject_type, subject_id, kind, body, actor }) {
  if (!validSubject(subject_type, subject_id)) return { error: 'invalid_subject' };
  const text = String(body ?? '').trim();
  if (!text) return { error: 'body_required' };
  return {
    row: {
      subject_type,
      subject_id: String(subject_id),
      kind: NOTE_KINDS.includes(kind) ? kind : 'note',
      body: text.slice(0, 4000),
      created_by: actor || null,
    },
  };
}

export function taskRow({ subject_type, subject_id, title, due_at, assigned_to, actor }) {
  if (!validSubject(subject_type, subject_id)) return { error: 'invalid_subject' };
  const name = String(title ?? '').trim();
  if (!name) return { error: 'title_required' };
  let due = null;
  if (due_at) {
    const d = new Date(due_at);
    if (Number.isNaN(d.getTime())) return { error: 'invalid_due_at' };
    due = d.toISOString();
  }
  return {
    row: {
      subject_type,
      subject_id: String(subject_id),
      title: name.slice(0, 200),
      due_at: due,
      assigned_to: assigned_to ? String(assigned_to).trim().slice(0, 160) : null,
      status: 'open',
      created_by: actor || null,
    },
  };
}

// `now` is injected so transitions are deterministic in tests.
export function taskPatch({ action, assigned_to, actor }, now) {
  const ts = (now || new Date()).toISOString();
  if (action === 'complete') return { patch: { status: 'done', completed_at: ts, completed_by: actor || null } };
  if (action === 'reopen') return { patch: { status: 'open', completed_at: null, completed_by: null } };
  if (action === 'reassign') return { patch: { assigned_to: assigned_to ? String(assigned_to).trim().slice(0, 160) : null } };
  return { error: 'invalid_action' };
}

// email_events.to_email is a comma-joined recipient list (to + bcc). Keep only the events
// addressed to one of this company's known emails (members + contacts). Split the joined list
// and match each recipient EXACTLY — a substring match would wrongly pull "newops@acme.com"
// into "ops@acme.com"'s timeline. Deduped by id. Pure — the handler does the querying.
export function filterCompanyEmails(events, emails) {
  const needles = new Set((emails || []).map((e) => String(e || '').toLowerCase().trim()).filter(Boolean));
  if (!needles.size) return [];
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    if (ev?.id == null || seen.has(ev.id)) continue;
    const recipients = String(ev?.to_email || '').toLowerCase().split(',').map((a) => a.trim()).filter(Boolean);
    if (recipients.some((addr) => needles.has(addr))) { seen.add(ev.id); out.push(ev); }
  }
  return out;
}

// taskDigest groups a caller-filtered array of overdue+open tasks by assignee email
// and returns per-group digests plus a total count. Pure — no I/O, no Date.now().
// `now` must be injected (a Date instance). `staffKey` is the bucket for tasks whose
// `assigned_to` is absent or not a valid email address (default '__staff__').
export function taskDigest(tasks, { now, staffKey = '__staff__' } = {}) {
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const buckets = new Map();
  for (const task of tasks || []) {
    const raw = String(task.assigned_to || '').trim().toLowerCase();
    const isEmail = EMAIL_RE.test(raw);
    const key = isEmail ? raw : staffKey;
    const assignee = isEmail ? raw : null;
    if (!buckets.has(key)) buckets.set(key, { key, assignee, tasks: [] });
    const dueMs = new Date(task.due_at).getTime();
    const overdueDays = Math.max(0, Math.floor((nowMs - dueMs) / 86400000));
    buckets.get(key).tasks.push({ ...task, overdueDays });
  }
  const groups = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const group of groups) {
    group.tasks.sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0));
  }
  return { groups, total: (tasks || []).length };
}

// Normalize heterogeneous source rows into one timeline shape, newest first.
// Each source is an array; missing/failed sources pass []. Bounded to `limit`.
export function mergeTimeline({ orders = [], messages = [], shipments = [], audit = [], quotes = [], notes = [], tasks = [], emails = [] }, { limit = 200 } = {}) {
  const items = [];
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  const cap = (s, n) => String(s ?? '').slice(0, n);
  for (const o of orders) items.push({ at: iso(o.created_at), type: 'order', title: `Order ${o.id} · ${o.status || 'pending'}`, detail: o.total != null ? `${String(o.currency || 'USD').toUpperCase()} ${Number(o.total).toFixed(2)}` : '', ref: { order: o.id } });
  for (const m of messages) items.push({ at: iso(m.created_at), type: 'message', title: `${m.sender_role === 'staff' ? 'Staff' : 'Buyer'} message`, detail: cap(m.body, 160), ref: { message: m.id } });
  for (const s of shipments) items.push({ at: iso(s.created_at), type: 'shipment', title: `Shipment ${s.status || ''}`.trim(), detail: [s.carrier, s.tracking_number].filter(Boolean).join(' '), ref: { order: s.order_id } });
  for (const a of audit) items.push({ at: iso(a.created_at), type: 'audit', title: a.action || 'audit', detail: a.actor_email || '', ref: { audit: true } });
  for (const q of quotes) items.push({ at: iso(q.created_at), type: 'quote', title: `Quote ${q.type || ''} · ${q.status || ''}`.replace(/ · $/, '').trim(), detail: q.product || '', ref: { quote: q.id } });
  for (const n of notes) {
    const k = n.kind || 'note';
    items.push({ at: iso(n.created_at), type: `note:${k}`, title: k.charAt(0).toUpperCase() + k.slice(1), detail: cap(n.body, 280), ref: { note: n.id }, by: n.created_by || '' });
  }
  for (const t of tasks) {
    items.push({ at: iso(t.created_at), type: 'task', title: `Task: ${t.title || ''}`.trim(), detail: t.assigned_to ? `→ ${t.assigned_to}` : 'unassigned', ref: { task: t.id }, by: t.created_by || '' });
    if (t.completed_at) items.push({ at: iso(t.completed_at), type: 'task_done', title: `Done: ${t.title || ''}`.trim(), detail: t.completed_by || '', ref: { task: t.id } });
  }
  for (const e of emails) {
    const st = e.status || 'sent';
    items.push({ at: iso(e.created_at), type: `email:${st}`, title: `Email ${st}`, detail: [e.subject, e.category].filter(Boolean).map((x) => cap(x, 120)).join(' · '), ref: { email: e.id } });
  }
  return items
    .filter((i) => i.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

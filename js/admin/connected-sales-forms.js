import { esc } from '../util.js?v=20260929e';

const input = (label, name, value = '', extra = '') => `<label class="crm-field">${label}<input class="adm-input" name="${name}" value="${esc(value ?? '')}" ${extra}></label>`;
const select = (label, name, options, value = '') => `<label class="crm-field">${label}<select class="adm-select" name="${name}">${options.map(([key, text]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const ownership = (editing = false) => select('Assignment', 'assignment', [...(editing ? [['keep', 'Keep current assignment']] : []), ['me', 'Assign to me'], ['clear', 'Unassigned']], editing ? 'keep' : 'me');
const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((v) => [v, v]);
const priorities = [['normal', 'Normal'], ['high', 'High']];
const localTime = (value) => {
  if (!value) return '';
  const d = new Date(value); const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function creationForms(context) {
  if (!context.can_edit_sales) return '<p>Read-only staff access.</p>';
  return `<form class="adm-card" data-sales-create="task"><fieldset data-sales-write><legend>New task</legend>
    ${input('Task title', 'title', '', 'required maxlength="200"')}
    <label class="crm-field">Notes<textarea class="adm-input" name="body" maxlength="4000"></textarea></label>
    ${input('Due date', 'due_at', '', 'type="datetime-local"')}${select('Priority', 'priority', priorities)}
    ${ownership()}<p class="muted">Linked to the selected prospect.</p><button class="btn btn-primary btn-sm" type="submit">Create task</button>
    </fieldset></form>
    <form class="adm-card" data-sales-create="deal"><fieldset data-sales-write><legend>New deal</legend>
    ${input('Deal title', 'title', '', 'required maxlength="200"')}${input('Amount', 'amount', '', 'inputmode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,2})?"')}
    ${select('Currency', 'currency', currencies, 'USD')}
    ${ownership()}<p class="muted">Uses the selected prospect and pipeline; starts in its first open stage.</p>
    <button class="btn btn-primary btn-sm" type="submit">Create deal</button></fieldset></form>
    ${context.can_manage_pipelines ? `<form class="adm-card" data-sales-create="pipeline"><fieldset data-sales-write><legend>New pipeline</legend>
    ${input('Pipeline name', 'name', '', 'required maxlength="200"')}<p class="muted">Starts with Open, Won and Lost stages.</p>
    <button class="btn btn-ghost btn-sm" type="submit">Create pipeline</button></fieldset></form>` : ''}`;
}

export function editorForm(record, kind, context, pipeline) {
  const owner = record.owner_staff_id === context.staff_id ? 'You' : record.owner_staff_id ? (context.staff_members?.get(record.owner_staff_id)?.display_name || 'Staff reference ' + record.owner_staff_id.slice(-8)) : record.owner_name ? `${record.owner_name} (name only)` : 'Unassigned';
  return `<h4 tabindex="-1">${esc(kind === 'task' ? 'Task details' : 'Deal details')}</h4><p>Revision ${record.revision} · ${esc(owner)}</p>
    <form data-sales-edit><fieldset data-sales-write ${context.can_edit_sales ? '' : 'disabled'}>
    ${input('Title', 'title', record.title, 'required maxlength="200"')}
    ${kind === 'task' ? `<label class="crm-field">Notes<textarea class="adm-input" name="body" maxlength="4000">${esc(record.body)}</textarea></label>
    ${select('Status', 'status', [['open', 'Open'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], record.status)}
    ${input('Due date', 'due_at', localTime(record.due_at), 'type="datetime-local"')}${select('Priority', 'priority', priorities, record.priority)}`
      : `${select('Stage', 'stage_id', pipeline.stages.map((s) => [s.id, s.name]), record.stage_id)}
    ${input('Amount', 'amount', record.amount, 'inputmode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,2})?"')}${select('Currency', 'currency', currencies, record.currency)}
    ${input('Expected close', 'expected_close', record.expected_close, 'type="date"')}${input('Close reason', 'close_reason', record.close_reason, 'maxlength="1000"')}`}
    ${ownership(true)}${input('Reason', 'reason', '', 'required maxlength="1000"')}
    ${context.can_edit_sales ? '<button class="btn btn-primary btn-sm" type="submit">Save changes</button>' : ''}</fieldset></form>
    <button class="btn btn-ghost btn-sm" type="button" data-sales-reload>Reload record</button>
    <p class="muted">Reload discards edits to this record.</p>`;
}

export function editorChanges(form, record, kind, staffId) {
  const values = Object.fromEntries(new FormData(form));
  const body = { action_id: crypto.randomUUID(), expected_revision: record.revision, reason: values.reason.trim() };
  const fields = kind === 'task' ? ['title', 'body', 'status', 'priority'] : ['title', 'stage_id', 'amount', 'currency', 'expected_close', 'close_reason'];
  for (const key of fields) {
    const value = ['amount', 'expected_close', 'close_reason'].includes(key) && !values[key] ? null : values[key];
    if (value !== record[key]) body[key] = value;
  }
  // Untouched due times retain precision and the original DST offset.
  if (kind === 'task' && values.due_at !== localTime(record.due_at)) body.due_at = values.due_at ? new Date(values.due_at).toISOString() : null;
  if (values.assignment !== 'keep') body.owner_staff_id = values.assignment === 'me' ? staffId : values.assignment === 'clear' ? null : values.assignment;
  return body;
}

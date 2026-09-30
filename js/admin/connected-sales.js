import { esc } from '../util.js?v=20260929e';
import { UUID, salesActions, salesPage, salesRecord, salesUrl, salesBoardPipeline, salesDealPage } from './connected-sales-contract.js?v=20260929e';
import { creationForms, editorForm, editorChanges } from './connected-sales-forms.js?v=20260929e';
import { createDailyWork, dailyMarkup } from './connected-daily-work.js?v=20260929e';

const message = (error) => error?.data?.error?.message || error?.message || 'CRM is unavailable. Retry.';

export function createConnectedSales({ api }) {
  let currentRoot; let refreshCurrent; let busy = false;
  const dailyState = { status: 'open' };
  async function render(body) {
    const root = document.createElement('div'); root.className = 'crm-intake';
    currentRoot = root; refreshCurrent = null; body.replaceChildren(root);
    root.innerHTML = '<h3>Sales workspace</h3><p role="status">Loading CRM…</p>';
    const active = () => currentRoot === root && root.isConnected;
    let context; let actions;
    try {
      context = await api(salesUrl('context'));
      if (!active()) return;
      actions = salesActions(api, context, sessionStorage);
    } catch (error) { if (active()) root.innerHTML = `<h3>Sales workspace</h3><p role="alert">${esc(message(error))}</p>`; return; }
    root.innerHTML = `<h3>Sales workspace</h3><p class="muted">Manage prospect work and commercial opportunities. Customer accounts and outreach consent remain separate.</p>
      <p data-sales-status role="status"></p><button class="btn btn-primary btn-sm" data-sales-retry hidden>Retry original change</button>
      ${dailyMarkup.summary}
      <form data-sales-search class="adm-tools"><label class="crm-field">Find prospect<input class="adm-search" name="q" maxlength="200" type="search"></label><button class="btn btn-ghost btn-sm">Search prospects</button></form>
      <label class="crm-field">Prospect<select class="adm-select" data-sales-prospect><option value="">Choose a prospect</option></select></label>
      <button class="btn btn-ghost btn-sm" data-sales-more-people hidden>More prospects</button>
      <label class="crm-field">Pipeline<select class="adm-select" data-sales-pipeline><option value="">Choose a pipeline</option></select></label>
      <button class="btn btn-ghost btn-sm" data-sales-more-pipelines hidden>More pipelines</button>
      <div data-sales-create-forms>${creationForms(context)}</div>
      <h4>Tasks</h4><button class="btn btn-ghost btn-sm" data-sales-refresh>Refresh tasks and board</button>
      ${dailyMarkup.filters}
      <div data-sales-tasks></div><button class="btn btn-ghost btn-sm" data-sales-more-tasks hidden>More tasks</button>
      <h4>Pipeline board</h4><div data-sales-board></div>
      <section data-sales-editor></section><section data-sales-history></section>${dailyMarkup.timeline}`;
    const at = (key) => root.querySelector(`[data-sales-${key}]`);
    const daily = createDailyWork({ api, root, active, staffId: context.staff_id, state: dailyState, onTasksChange: () => tasks() });
    let peopleCursor = null; let taskCursor = null; let pipelineCursor = null; let historyCursor = null;
    let peopleQuery = ''; let pipelines = new Map(); let selected = null; let selectedKind = null; let conflict = false;
    let peopleVersion = 0; let pipelineVersion = 0; let taskVersion = 0; let boardVersion = 0; let detailVersion = 0; let historyVersion = 0;
    let ready = false;
    const status = (text) => { if (active()) at('status').textContent = text; };
    function controls() {
      if (!active()) return;
      root.querySelectorAll('[data-sales-write]').forEach((el) => { el.disabled = busy || Boolean(actions.pending) || !ready || !context.can_edit_sales || (conflict && el.closest('[data-sales-editor]')); });
      at('retry').hidden = !actions.pending; at('retry').disabled = busy || !context.can_edit_sales;
      if (actions.pending) status('Change outcome unconfirmed. Retry the original change before making another.');
    }
    const options = (select, items, label, append) => {
      const before = select.value;
      if (!append) select.replaceChildren(new Option('Choose a ' + label, ''));
      const existing = new Set([...select.options].map((o) => o.value));
      for (const item of items) if (!existing.has(item.id)) select.add(new Option(item.name || 'Unnamed prospect', item.id));
      if ([...select.options].some((o) => o.value === before)) select.value = before;
    };
    async function people(append = false) {
      const version = ++peopleVersion;
      const page = salesPage(await api(salesUrl('people', { limit: '50', q: peopleQuery, ...(append && peopleCursor ? { cursor: peopleCursor } : {}) })), (p) => { if (!UUID.test(p.id) || typeof p.name !== 'string') throw new Error('Invalid prospect list.'); });
      if (!active() || version !== peopleVersion) return;
      options(at('prospect'), page.items, 'prospect', append); peopleCursor = page.next_cursor; at('more-people').hidden = !peopleCursor;
      if (!append) await daily.prospectChanged();
    }
    async function catalog(append = false, choose = null) {
      const version = ++pipelineVersion;
      const page = salesPage(await api(salesUrl('sales_pipelines', { limit: '25', ...(append && pipelineCursor ? { cursor: pipelineCursor } : {}) })), (p) => salesRecord(p, 'pipeline'));
      if (!active() || version !== pipelineVersion) return;
      if (!append) pipelines = new Map();
      for (const p of page.items) pipelines.set(p.id, p);
      options(at('pipeline'), page.items, 'pipeline', append); pipelineCursor = page.next_cursor; at('more-pipelines').hidden = !pipelineCursor;
      if (choose) at('pipeline').value = choose;
      if (!at('pipeline').value && page.items.length) at('pipeline').value = page.items[0].id;
    }
    const openButton = (record, kind) => `<button type="button" class="btn btn-ghost btn-sm" data-sales-open="${kind}" data-id="${esc(record.id)}">Open ${kind} ${esc(record.title)}</button>`;
    async function tasks(append = false) {
      const version = ++taskVersion;
      const filters = daily.taskParams(); const note = root.querySelector('[data-daily-task-status]');
      if (!append) { taskCursor = null; at('tasks').replaceChildren(); at('more-tasks').hidden = true; }
      if (!filters) { note.textContent = 'Choose a prospect for this task view.'; return; }
      note.textContent = 'Loading tasks…'; at('more-tasks').disabled = true;
      try {
        const page = salesPage(await api(salesUrl('sales_tasks', { ...filters, limit: '25', ...(append && taskCursor ? { cursor: taskCursor } : {}) })), (t) => salesRecord(t, 'task'));
        if (!active() || version !== taskVersion) return;
        const markup = page.items.map((t) => `<article class="crm-contact">${openButton(t, 'task')}<p>${esc(t.status)} · ${esc(t.priority)}${t.due_at ? ' · Due ' + esc(new Date(t.due_at).toLocaleString()) : ' · No due date'}</p></article>`).join('');
        at('tasks').insertAdjacentHTML('beforeend', markup);
        note.textContent = at('tasks').children.length ? `${at('tasks').children.length} tasks shown.` : 'No tasks match these filters.';
        taskCursor = page.next_cursor; at('more-tasks').hidden = !taskCursor;
      } catch (error) { if (active() && version === taskVersion) note.textContent = 'Tasks unavailable: ' + message(error); }
      finally { if (active() && version === taskVersion) at('more-tasks').disabled = false; }
    }
    async function board() {
      const version = ++boardVersion; const id = at('pipeline').value;
      if (!id) { at('board').textContent = 'Choose or create a pipeline.'; return; }
      at('board').textContent = 'Loading pipeline…';
      const value = await api(salesUrl('sales_board', { pipeline_id: id }));
      const pipeline = salesBoardPipeline(value, id);
      if (!Array.isArray(value.items) || value.items.length !== pipeline.stages.length) throw new Error('Invalid pipeline board.');
      const columns = value.items.map((column, i) => {
        if (column.stage?.id !== pipeline.stages[i].id || !Number.isInteger(column.count) || !Array.isArray(column.totals)) throw new Error('Invalid pipeline column.');
        salesDealPage(column.deals, id, column.stage.id);
        return `<section class="adm-card"><h5>${esc(column.stage.name)} (${column.count})</h5><p>${column.totals.map((t) => `${esc(t.amount ?? 'Unknown')} ${esc(t.currency)}${t.unknown_amount_count ? ' · ' + t.unknown_amount_count + ' unknown amounts' : ''}`).join('; ')}</p>
          <div data-sales-column="${esc(column.stage.id)}">${column.deals.items.map((d) => openButton(d, 'deal')).join('') || '<p>No deals in this stage.</p>'}</div>
          ${column.deals.next_cursor ? `<button class="btn btn-ghost btn-sm" data-sales-more-deals data-stage="${esc(column.stage.id)}" data-cursor="${esc(column.deals.next_cursor)}" data-pipeline="${id}">More ${esc(column.stage.name)} deals</button>` : ''}</section>`;
      }).join('');
      if (active() && version === boardVersion) at('board').innerHTML = columns;
    }
    async function history(append = false) {
      const version = ++historyVersion; const record = selected; const kind = selectedKind;
      if (!record) return;
      const page = salesPage(await api(salesUrl('sales_events', { entity_type: kind, entity_id: record.id, limit: '10', ...(append && historyCursor ? { cursor: historyCursor } : {}) })), (e) => {
        if (!UUID.test(e.id) || e[`${kind}_id`] !== record.id || typeof e.reason !== 'string') throw new Error('Invalid CRM history.');
      });
      if (!active() || version !== historyVersion || selected?.id !== record.id) return;
      const markup = page.items.map((e) => `<article class="crm-contact"><p>${esc(e.reason)}</p><p>${esc(e.actor_role || 'Local operator')} · ${esc(new Date(e.created_at).toLocaleString())}</p><details><summary>Change details</summary><pre>${esc(JSON.stringify({ before: e.before, after: e.after, actor_staff_id: e.actor_staff_id }, null, 2))}</pre></details></article>`).join('');
      if (!append) at('history').innerHTML = '<h4>Change history</h4><div data-sales-events></div><button class="btn btn-ghost btn-sm" data-sales-more-history hidden>More history</button>';
      at('events').insertAdjacentHTML('beforeend', markup); historyCursor = page.next_cursor; at('more-history').hidden = !historyCursor;
    }
    async function open(kind, id) {
      const version = ++detailVersion; ++historyVersion; selected = null; conflict = false;
      at('editor').textContent = 'Loading record…'; at('history').replaceChildren();
      const record = salesRecord(await api(salesUrl(`sales_${kind}`, { record_id: id })), kind);
      if (record.id !== id) throw new Error('Record identity mismatch.');
      let pipeline;
      if (kind === 'deal') {
        pipeline = salesBoardPipeline(await api(salesUrl('sales_board', { pipeline_id: record.pipeline_id })), record.pipeline_id);
        if (!pipeline.stages.some((stage) => stage.id === record.stage_id)) throw new Error('Invalid deal stage.');
      }
      if (!active() || version !== detailVersion) return;
      selected = record; selectedKind = kind;
      at('editor').innerHTML = editorForm(record, kind, context, pipeline); controls(); at('editor').querySelector('h4').focus();
      try { await history(); } catch (error) { if (active() && selected?.id === id) at('history').textContent = 'History unavailable: ' + message(error); }
    }
    async function change(resource, params, command, retry = false) {
      if (busy) return;
      const outcome = { saved: false, error: null };
      busy = true; controls();
      try {
        const value = retry ? await actions.retry() : await actions.execute(resource, params, command);
        outcome.saved = true;
        if (!active()) return;
        status('Change saved.');
        if (resource === 'sales_pipelines') await catalog(false, value.id);
        await Promise.all([tasks(), board(), daily.refresh()]);
        if (resource !== 'sales_pipelines') await open(resource.includes('task') ? 'task' : 'deal', value.id);
      } catch (error) {
        outcome.error = message(error);
        if (active()) { status(outcome.error); if (error.data?.error?.code === 'revision_conflict') conflict = true; }
      }
      finally {
        busy = false;
        if (active()) controls(); else if (refreshCurrent) await refreshCurrent(outcome);
      }
    }
    refreshCurrent = async (outcome) => {
      if (!active()) return;
      try {
        actions = salesActions(api, context, sessionStorage); controls();
        if (outcome.error) status(outcome.error);
        else if (outcome.saved) status('Change saved.');
        await catalog(); await Promise.all([tasks(), board(), daily.refresh()]);
      } catch (error) { status(message(error)); }
    };
    const guarded = (work) => async (event) => { try { await work(event); } catch (error) { status(message(error)); } };
    root.addEventListener('submit', guarded(async (event) => {
      event.preventDefault(); const form = event.target;
      if (form.matches('[data-sales-search]')) { peopleQuery = new FormData(form).get('q'); await people(); return; }
      if (!ready || busy || actions.pending || !context.can_edit_sales) return;
      if (form.matches('[data-sales-edit]')) {
        if (!selected || conflict) return;
        await change(`sales_${selectedKind}`, { record_id: selected.id }, editorChanges(form, selected, selectedKind, context.staff_id)); return;
      }
      const kind = form.dataset.salesCreate; if (!kind) return;
      const values = Object.fromEntries(new FormData(form)); const command = { action_id: crypto.randomUUID() };
      if (kind === 'pipeline') Object.assign(command, { name: values.name.trim(), stages: [{ name: 'Open', kind: 'open' }, { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' }] });
      else {
        if (!at('prospect').value) throw new Error('Choose a prospect first.');
        Object.assign(command, { title: values.title.trim(), person_id: at('prospect').value, owner_staff_id: context.staff_id });
        if (kind === 'task') Object.assign(command, { body: values.body, priority: values.priority, due_at: values.due_at ? new Date(values.due_at).toISOString() : null });
        else {
          const pipeline = pipelines.get(at('pipeline').value); if (!pipeline) throw new Error('Choose a pipeline first.');
          Object.assign(command, { pipeline_id: pipeline.id, stage_id: pipeline.stages.find((s) => s.kind === 'open').id, amount: values.amount || null, currency: values.currency });
        }
      }
      await change(`sales_${kind === 'pipeline' ? 'pipelines' : kind + 's'}`, {}, command);
    }));
    root.addEventListener('click', guarded(async (event) => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.matches('[data-sales-retry]')) { const p = actions.pending; if (p) await change(p.resource, p.params, p.body, true); }
      else if (button.matches('[data-sales-open]')) await open(button.dataset.salesOpen, button.dataset.id);
      else if (button.matches('[data-sales-reload]') && selected) await open(selectedKind, selected.id);
      else if (button.matches('[data-sales-more-people]')) await people(true);
      else if (button.matches('[data-sales-more-pipelines]')) await catalog(true);
      else if (button.matches('[data-sales-more-tasks]')) await tasks(true);
      else if (button.matches('[data-sales-more-history]')) await history(true);
      else if (button.matches('[data-sales-refresh]')) await Promise.all([tasks(), board(), daily.refresh()]);
      else if (button.matches('[data-sales-more-deals]')) {
        button.disabled = true;
        try {
          const page = salesDealPage(await api(salesUrl('sales_deals', { pipeline_id: button.dataset.pipeline, stage_id: button.dataset.stage, cursor: button.dataset.cursor, limit: '10' })), button.dataset.pipeline, button.dataset.stage);
          if (!active() || !button.isConnected) return;
          button.previousElementSibling.insertAdjacentHTML('beforeend', page.items.map((d) => openButton(d, 'deal')).join(''));
          if (page.next_cursor) button.dataset.cursor = page.next_cursor; else button.remove();
        } finally { button.disabled = false; }
      }
    }));
    at('pipeline').addEventListener('change', guarded(board));
    at('prospect').addEventListener('change', () => daily.prospectChanged());
    controls();
    try { await Promise.all([people(), catalog(), tasks(), daily.summary()]); await board(); ready = true; controls(); }
    catch (error) { status(message(error)); }
  }
  return { render };
}

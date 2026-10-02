// Strict receipts and tab-scoped exact retry, keyed by verified workspace/staff.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => { throw new Error('CRM response is invalid. Retry the original change.'); };
const timestamp = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const money = (value) => typeof value === 'string' && /^\d{1,12}\.\d{2}$/.test(value);

export function salesRecord(value, kind) {
  if (!value || !UUID.test(value.id)) return invalid();
  if (kind === 'pipeline') {
    if (typeof value.name !== 'string' || !Array.isArray(value.stages) || value.stages.length < 3 || value.stages.length > 12
        || !['open', 'won', 'lost'].every((kind) => value.stages.some((s) => s.kind === kind))
        || new Set(value.stages.map((s) => s.id)).size !== value.stages.length
        || value.stages.some((s, i) => !UUID.test(s.id) || s.pipeline_id !== value.id || s.position !== i || typeof s.name !== 'string' || !['open', 'won', 'lost'].includes(s.kind))) return invalid();
  } else {
    if (!Number.isInteger(value.revision) || value.revision < 1 || typeof value.title !== 'string'
        || !(value.owner_staff_id === null || UUID.test(value.owner_staff_id))
        || !(value.owner_name === null || typeof value.owner_name === 'string')) return invalid();
    if (kind === 'task' && (typeof value.body !== 'string' || !['open', 'completed', 'cancelled'].includes(value.status)
        || !['normal', 'high'].includes(value.priority) || !(value.due_at === null || timestamp(value.due_at))
        || (value.status === 'completed' ? !timestamp(value.completed_at) : value.completed_at !== null))) return invalid();
    if (kind === 'deal' && (!UUID.test(value.pipeline_id) || !UUID.test(value.stage_id) || !['open', 'won', 'lost'].includes(value.status)
        || !['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(value.currency) || !(value.amount === null || money(value.amount)))) return invalid();
  }
  return value;
}

export function salesPage(value, validate) {
  if (!value || !Array.isArray(value.items) || value.items.length > 100
      || !(value.next_cursor === null || typeof value.next_cursor === 'string')) return invalid();
  value.items.forEach(validate);
  return value;
}

export function salesBoardPipeline(value, pipelineId) {
  const pipeline = salesRecord(value?.pipeline, 'pipeline');
  if (pipeline.id !== pipelineId) return invalid();
  return pipeline;
}

export function salesDealPage(value, pipelineId, stageId) {
  return salesPage(value, (deal) => {
    salesRecord(deal, 'deal');
    if (deal.pipeline_id !== pipelineId || deal.stage_id !== stageId) return invalid();
  });
}

export function salesUrl(resource, params = {}) {
  return '/api/admin/connected-crm?' + new URLSearchParams({ resource, ...params });
}

export function salesSummary(value) {
  const count = (v) => Number.isSafeInteger(v) && v >= 0;
  if (!value || !['open', 'overdue', 'completed'].every((key) => count(value.tasks?.[key]))
      || value.tasks.overdue > value.tasks.open || !Array.isArray(value.deals) || value.deals.length > 15) return invalid();
  const seen = new Set();
  for (const d of value.deals) {
    const key = `${d.currency}:${d.status}`;
    if (seen.has(key) || !['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(d.currency) || !['open', 'won', 'lost'].includes(d.status)
        || !count(d.count) || !count(d.unknown_amount_count) || d.unknown_amount_count > d.count
        || !(d.amount === null ? d.unknown_amount_count === d.count : typeof d.amount === 'string' && /^\d+\.\d{2}$/.test(d.amount))) return invalid();
    seen.add(key);
  }
  return value;
}

export function salesTimeline(value, personId, scope = 'person_id') {
  return salesPage(value, (event) => {
    if (!event || !UUID.test(event.id) || event[scope] !== personId || !UUID.test(event.entity_id)
        || !['task', 'deal'].includes(event.entity_type) || !timestamp(event.created_at)
        || typeof event.title !== 'string' || event.title.length > 200 || typeof event.reason !== 'string' || event.reason.length > 1000
        || !(event.actor_staff_id === null && event.actor_role === null || UUID.test(event.actor_staff_id) && ['owner', 'finance', 'support'].includes(event.actor_role))) return invalid();
  });
}

export function salesActions(api, context, storage) {
  if (!UUID.test(context.workspace_id) || !UUID.test(context.staff_id)) return invalid();
  const key = `masest.crm.sales.v1:${context.workspace_id}:${context.staff_id}`;
  let pending = null;
  const kinds = { sales_tasks: 'task', sales_task: 'task', sales_deals: 'deal', sales_deal: 'deal', sales_pipelines: 'pipeline' };
  const validate = (value) => {
    if (!value || !Object.hasOwn(kinds, value.resource) || !value.body || !UUID.test(value.body.action_id)
        || !value.params || Object.keys(value.params).some((k) => k !== 'record_id')
        || (['sales_task', 'sales_deal'].includes(value.resource) ? !UUID.test(value.params.record_id) : Object.keys(value.params).length)) return invalid();
    return value;
  };
  const raw = storage.getItem(key);
  if (raw) pending = validate(JSON.parse(raw));
  async function retry() {
    const intent = pending;
    if (!intent) throw new Error('No pending change.');
    try {
      const value = salesRecord(await api(salesUrl(intent.resource, intent.params), { method: 'POST', body: intent.body }), kinds[intent.resource]);
      if (intent.params.record_id && (value.id !== intent.params.record_id || value.revision !== intent.body.expected_revision + 1)) return invalid();
      if (!intent.params.record_id && kinds[intent.resource] !== 'pipeline' && value.revision !== 1) return invalid();
      for (const [field, requested] of Object.entries(intent.body)) {
        if (['action_id', 'expected_revision', 'reason'].includes(field)) continue;
        if (field === 'stages') {
          if (value.stages.length !== requested.length || requested.some((s, i) => s.name !== value.stages[i].name || s.kind !== value.stages[i].kind)) return invalid();
          continue;
        }
        const expected = field === 'amount' && requested !== null ? requested.split('.')[0].replace(/^0+(?=\d)/, '') + '.' + (requested.split('.')[1] || '').padEnd(2, '0') : requested;
        if (field === 'due_at' && requested !== null ? Date.parse(value[field]) !== Date.parse(requested) : value[field] !== expected) return invalid();
      }
      storage.removeItem(key); pending = null;
      return value;
    } catch (error) {
      // Only explicit command failures prove rollback. Auth/throttling failures
      // can occur after an earlier committed attempt whose receipt was lost.
      const definitive = ['validation_error', 'revision_conflict', 'sales_record_not_found', 'sales_identity_hold', 'sales_stage_invalid', 'sales_close_reason_required', 'sales_opportunity_already_linked', 'staff_assignment_required'];
      if (([404, 409, 422].includes(error.status) && definitive.includes(error.data?.error?.code))
          || (error.status === 403 && error.data?.error?.code === 'assignee_unavailable')) {
        storage.removeItem(key); pending = null;
      }
      throw error;
    }
  }
  return {
    get pending() { return pending; },
    retry,
    async execute(resource, params, body) {
      if (pending) throw new Error('Resolve the pending change first.');
      const intent = validate({ resource, params, body });
      storage.setItem(key, JSON.stringify(intent)); pending = intent;
      return retry();
    },
  };
}

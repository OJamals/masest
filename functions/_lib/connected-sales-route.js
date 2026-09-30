// Narrow route translation, never an arbitrary upstream path supplied by a browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const page = ['limit', 'cursor'];
const routes = {
  sales_tasks: { path: 'tasks', write: true, query: [...page, 'status', 'deal_id', 'owner_staff_id', 'person_id', 'priority', 'due', 'assignment'] },
  sales_task: { path: 'tasks', id: 'record_id', write: true, query: [] },
  sales_deals: { path: 'deals', write: true, query: [...page, 'status', 'pipeline_id', 'stage_id', 'owner_staff_id', 'person_id'] },
  sales_deal: { path: 'deals', id: 'record_id', write: true, query: [] },
  sales_pipelines: { path: 'pipelines', write: true, query: page },
  sales_board: { path: 'pipelines', id: 'pipeline_id', suffix: '/board', query: ['limit_per_stage'] },
  sales_events: { path: 'events', query: [...page, 'entity_type', 'entity_id'], required: ['entity_type', 'entity_id'] },
  sales_summary: { path: 'summary', query: [] },
  sales_timeline: { path: 'people', id: 'person_id', suffix: '/timeline', query: page },
};

export function connectedSalesTarget(params, method) {
  const resource = params.get('resource'); const route = routes[resource];
  if (!route || (method === 'POST' && !route.write)) return null;
  const queryKeys = method === 'POST' ? [] : route.query;
  const allowed = new Set(['resource', ...(route.id ? [route.id] : []), ...queryKeys]);
  if ([...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)
      || (route.id && !UUID.test(params.get(route.id) || ''))
      || route.required?.some((key) => !params.has(key))) return null;
  const query = new URLSearchParams();
  for (const key of queryKeys) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    if ((key.endsWith('_id') && !UUID.test(value))
        || (key === 'entity_type' && !['task', 'deal', 'pipeline'].includes(value))
        || (key === 'status' && !(resource === 'sales_tasks' ? ['open', 'completed', 'cancelled'] : ['open', 'won', 'lost']).includes(value))
        || (key === 'priority' && !['normal', 'high'].includes(value))
        || (key === 'due' && !['overdue', 'unscheduled'].includes(value))
        || (key === 'assignment' && value !== 'unassigned')
        || (key === 'cursor' && value.length > 2000)
        || (key.startsWith('limit') && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > (key === 'limit_per_stage' ? 25 : 100)))) return null;
    query.set(key, value);
  }
  return `/v1/sales/${route.path}${route.id ? '/' + params.get(route.id) : ''}${route.suffix || ''}${query.size ? '?' + query : ''}`;
}

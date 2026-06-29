// Pure, DOM-free helpers for the CRM task inbox assignee filter. Kept isolated
// (no imports) so the logic is unit-testable in Node and the UI module stays a
// thin renderer. The filter is purely client-side over the already-loaded task
// list — it adds no API surface and no schema dependency.

export const UNASSIGNED = '__unassigned__';

const assigneeOf = (task) => String(task?.assigned_to || '').trim();

// Build the assignee facet options for the inbox <select>: an "All" head with
// the total count, one option per distinct assignee (case-insensitive sort,
// original casing preserved), and an "Unassigned" bucket sorted last. The UI
// shows the control only when more than one bucket exists (facets.length > 2).
export function taskAssigneeFacets(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const counts = new Map(); // value -> { label, count }
  let unassigned = 0;
  for (const task of list) {
    const who = assigneeOf(task);
    if (!who) { unassigned += 1; continue; }
    const entry = counts.get(who) || { label: who, count: 0 };
    entry.count += 1;
    counts.set(who, entry);
  }
  const named = [...counts.entries()]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  const facets = [{ value: '', label: 'All assignees', count: list.length }, ...named];
  if (unassigned) facets.push({ value: UNASSIGNED, label: 'Unassigned', count: unassigned });
  return facets;
}

// Narrow a loaded task list by the selected assignee facet value. '' = all,
// UNASSIGNED = tasks with no assignee, otherwise an exact assigned_to match.
export function filterTasksByAssignee(tasks = [], assignee = '') {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!assignee) return list.slice();
  if (assignee === UNASSIGNED) return list.filter((task) => !assigneeOf(task));
  return list.filter((task) => assigneeOf(task) === assignee);
}

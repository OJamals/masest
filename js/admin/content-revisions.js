// CMS revision history (extracted from content.js, #36 split). Read-only display of an
// entry's saved revisions: the list, and a field-level diff of any version against the
// current editor state. Restoring a revision writes the editor form and touches lock +
// list-render state, so that ONE write action stays in content.js (the editor domain);
// this module only renders the [data-content-revision-restore] button that triggers it.
// The diff compares against live editor state, read via the injected getCurrentEntry
// getter. Shared primitives ($, api, admSkeleton, admEmpty) are injected; esc + the diff
// helpers come from their own modules.
import { esc } from "../util.js?v=20260711s";
import { diffContentFields, formatFieldValue } from "./content-diff.js?v=20260711s";

export function createContentRevisions({ $, api, admSkeleton, admEmpty, getCurrentEntry }) {
  let revisionsCache = [];

  function renderRevisionList(revisions = []) {
    if (!revisions.length) {
      return admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.");
    }
    return revisions.map((revision) => `
      <button class="adm-list-row adm-content-revision-row" type="button" data-content-revision="${esc(revision.version)}" aria-controls="contentRevisionDiff" aria-label="Compare version ${esc(revision.version)} with the current entry">
        <b>Version ${esc(revision.version)}</b>
        <span>${esc(revision.status || "")}${revision.created_at ? ` · ${esc(new Date(revision.created_at).toLocaleString())}` : ""}</span>
        ${revision.note ? `<small>${esc(revision.note)}</small>` : ""}
      </button>
    `).join("");
  }

  function closeRevisionDiff() {
    const panel = $("contentRevisionDiff");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
    $("contentRevisionList")?.querySelectorAll('[aria-expanded="true"]').forEach((row) => row.setAttribute("aria-expanded", "false"));
  }

  async function loadRevisions(entry = {}) {
    const list = $("contentRevisionList");
    if (!list) return;
    if (!entry.type || !entry.slug) {
      revisionsCache = [];
      list.innerHTML = admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.");
      return;
    }
    list.innerHTML = admSkeleton(3);
    closeRevisionDiff();
    const query = new URLSearchParams({
      type: entry.type,
      slug: entry.slug,
      locale: entry.locale || "en",
    });
    try {
      const data = await api(`/api/admin/content-revisions?${query.toString()}`);
      revisionsCache = data.revisions || [];
      list.innerHTML = renderRevisionList(revisionsCache);
    } catch (error) {
      revisionsCache = [];
      list.innerHTML = admEmpty(
        "ph-warning",
        "Revision history unavailable",
        error.data?.message || error.data?.error || error.message || "Try again.",
      );
    }
  }

  // Inspect a revision: show a field-level diff against the current saved entry
  // so the editor sees exactly what restoring would change before committing.
  function inspectRevision(version) {
    const list = $("contentRevisionList");
    const panel = $("contentRevisionDiff");
    if (!list || !panel) return;
    const revision = revisionsCache.find((r) => String(r.version) === String(version));
    if (!revision) return;
    list.querySelectorAll('[aria-expanded="true"]').forEach((row) => row.setAttribute("aria-expanded", "false"));
    list.querySelector(`[data-content-revision="${CSS.escape(String(version))}"]`)?.setAttribute("aria-expanded", "true");
    const { fields, changedCount } = diffContentFields(getCurrentEntry(), revision);
    const rows = fields.map((field) => `
      <tr class="${field.changed ? "is-changed" : ""}">
        <th scope="row">${esc(field.key)}</th>
        <td>${esc(formatFieldValue(field.from))}</td>
        <td>${esc(formatFieldValue(field.to))}</td>
      </tr>`).join("");
    panel.innerHTML = `
      <div class="adm-content-revision-diff-head">
        <strong>Version ${esc(version)} vs current</strong>
        <span class="muted">${changedCount} field${changedCount === 1 ? "" : "s"} differ${changedCount === 1 ? "s" : ""}</span>
      </div>
      <div class="adm-content-revision-diff-scroll">
        <table class="adm-content-revision-diff-table">
          <thead><tr><th>Field</th><th>Current</th><th>Version ${esc(version)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="adm-content-revision-diff-actions">
        <button class="btn btn-primary btn-sm" type="button" data-content-revision-restore="${esc(version)}" data-capability="content.write">Restore version ${esc(version)} as draft</button>
        <button class="btn btn-ghost btn-sm" type="button" data-content-revision-close>Close</button>
      </div>`;
    panel.hidden = false;
    panel.scrollIntoView({ block: "nearest" });
  }

  return { loadRevisions, inspectRevision, closeRevisionDiff };
}

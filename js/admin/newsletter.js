// Admin Newsletter tab (#36 per-tab split pattern, mirrors js/admin/reviews.js and
// js/admin/crm-workspace.js). Compose/edit + drafts+queue + settings sub-sections live
// under one tab, switched with a small in-panel sub-nav (state.nlSection). Shared
// primitives ($, api, state, message, admSkeleton, admEmpty, badge) are injected;
// esc/delegate/confirmDialog come from util.js. Recipients management is a sibling
// module (./recipients.js) mounted into its own container in the same panel.
import { esc, delegate, confirmDialog } from '../util.js';
import { renderNewsletterBody } from '../newsletter-render.js';

const SECTIONS = [
  ['compose', 'Compose'],
  ['queue', 'Drafts & queue'],
  ['recipients', 'Recipients'],
  ['settings', 'Settings'],
];

const POPULATIONS = [
  ['users', 'nlAudUsers', 'nlCountUsers', 'Registered users'],
  ['leads', 'nlAudLeads', 'nlCountLeads', 'Klaviyo leads'],
  ['imported', 'nlAudImported', 'nlCountImported', 'Imported / manual'],
];

function statusBadge(status) {
  return `<span class="badge" data-s="${esc(status)}">${esc(String(status || 'draft').replaceAll('_', ' '))}</span>`;
}

function dateTimeLocalValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextRunText(n) {
  if (n.status === 'sent') return n.sent_at ? new Date(n.sent_at).toLocaleString() : '—';
  if (n.status === 'scheduled') {
    const at = n.schedule?.next_run_at || n.schedule?.send_at;
    return at ? new Date(at).toLocaleString() : '—';
  }
  return '—';
}

// Small styled prompt dialogs (mirrors util.js confirmDialog / content.js
// promptAltText) so image-insert and test-send don't fall back to window.prompt.
function promptImageDetails() {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
      <p class="confirm-dialog-msg">Insert an image into the newsletter body.</p>
      <label>Image URL <input class="adm-input" type="url" data-nl-img-url required placeholder="https://…"></label>
      <label>Alt text <input class="adm-input" data-nl-img-alt placeholder="Describe the image"></label>
      <menu class="confirm-dialog-actions">
        <button value="cancel" class="btn btn-ghost btn-sm" type="submit">Cancel</button>
        <button value="ok" class="btn btn-primary btn-sm" type="submit">Insert</button>
      </menu>
    </form>`;
    if (typeof dlg.showModal !== 'function') { resolve(null); return; }
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const url = dlg.querySelector('[data-nl-img-url]')?.value.trim() || '';
      const alt = dlg.querySelector('[data-nl-img-alt]')?.value.trim() || '';
      dlg.remove();
      resolve(ok && url ? { url, alt } : null);
    });
    dlg.showModal();
    dlg.querySelector('[data-nl-img-url]')?.focus();
  });
}

function promptTestEmail(defaultVal = '') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
      <p class="confirm-dialog-msg">Send a test email to:</p>
      <label>Email <input class="adm-input" type="email" data-nl-test-email value="${esc(defaultVal)}" placeholder="you@masest.co"></label>
      <menu class="confirm-dialog-actions">
        <button value="cancel" class="btn btn-ghost btn-sm" type="submit">Cancel</button>
        <button value="ok" class="btn btn-primary btn-sm" type="submit">Send test</button>
      </menu>
    </form>`;
    if (typeof dlg.showModal !== 'function') { resolve(null); return; }
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const email = dlg.querySelector('[data-nl-test-email]')?.value.trim() || '';
      dlg.remove();
      resolve(ok ? email : null);
    });
    dlg.showModal();
    dlg.querySelector('[data-nl-test-email]')?.focus();
  });
}

export function createNewsletterTab({ $, api, state, message, admSkeleton, admEmpty, badge }) {
  let mounted = false;
  let editingId = null; // null = new/unsaved draft
  let blogPosts = null; // cached /data/content/blog.json list
  let counts = { users: 0, leads: 0, imported: 0 };

  function box() { return $('admNewsletter'); }

  function shellTemplate() {
    const section = state.nlSection || 'compose';
    return `
      <div class="crm-tabs" role="group" aria-label="Newsletter sections">
        ${SECTIONS.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === section ? ' is-active' : ''}" type="button" data-nl-section="${v}" aria-pressed="${v === section}">${esc(l)}</button>`).join('')}
      </div>
      <div data-nl-body aria-live="polite"></div>
    `;
  }

  function composeTemplate() {
    return `
      <div class="adm-card">
        <div class="adm-panel-header">
          <div>
            <p class="adm-eyebrow">Newsletter</p>
            <h2 id="nlEditorHeading">${editingId ? 'Edit newsletter' : 'New newsletter'}</h2>
            <p class="muted">Compose from scratch or pull in a published blog post, then save, test, schedule, or send.</p>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-nl-action="new"><i class="ph ph-plus" aria-hidden="true"></i> New</button>
        </div>
        <form id="nlForm" class="adm-form-grid" onsubmit="return false">
          <input type="hidden" id="nlId" value="${editingId ? esc(editingId) : ''}">
          <label class="wide">Source
            <select id="nlSource" class="adm-select">
              <option value="compose">Compose</option>
              <option value="blog_post">From blog post</option>
            </select>
          </label>
          <label class="wide" id="nlBlogPickWrap" hidden>Blog post
            <select id="nlBlogPick" class="adm-select"><option value="">Choose a post…</option></select>
          </label>
          <label class="full">Subject <input id="nlSubject" class="adm-input" maxlength="300" required></label>
          <div class="full">
            <div class="adm-md-tools">
              <button type="button" class="btn btn-ghost btn-sm" id="nlInsertImage"><i class="ph ph-image" aria-hidden="true"></i> Insert image</button>
              <span class="adm-md-hint">Markdown + raw HTML: **bold**, ## heading, - list, [text](url), &lt;div&gt;…&lt;/div&gt;</span>
            </div>
            <label>Body <textarea id="nlBody" class="adm-textarea adm-content-field-text" style="min-height:220px" spellcheck="true"></textarea></label>
            <div class="adm-md-preview">
              <span class="adm-md-preview-label">Preview</span>
              <div id="nlPreview" class="adm-md-preview-body blog-body"></div>
            </div>
          </div>
          <div class="full">
            <p class="adm-eyebrow" style="margin-top:6px">Audience</p>
            <div class="adm-inline-actions">
              ${POPULATIONS.map(([, inputId, countId, label]) => `
                <label class="adm-content-check"><input type="checkbox" id="${inputId}"> ${esc(label)} <span id="${countId}" class="pill">0</span></label>
              `).join('')}
            </div>
          </div>
          <div class="adm-inline-actions full" aria-label="Newsletter actions">
            <button class="btn btn-secondary btn-sm" type="button" data-nl-action="save"><i class="ph ph-floppy-disk" aria-hidden="true"></i> Save draft</button>
            <button class="btn btn-ghost btn-sm" type="button" data-nl-action="test_send"><i class="ph ph-paper-plane-tilt" aria-hidden="true"></i> Send test</button>
            <button class="btn btn-primary btn-sm" type="button" data-nl-action="send_now"><i class="ph ph-rocket-launch" aria-hidden="true"></i> Send now</button>
          </div>
          <details class="adm-content-json full">
            <summary>Schedule</summary>
            <div class="adm-form-grid" style="margin-top:8px">
              <label>Mode
                <select id="nlSchedMode" class="adm-select">
                  <option value="once">Once</option>
                  <option value="recurring">Recurring</option>
                </select>
              </label>
              <label id="nlSchedAtWrap">Send at <input id="nlSchedAt" class="adm-input" type="datetime-local"></label>
              <label id="nlSchedIntervalWrap" class="wide" hidden>Repeat every
                <select id="nlSchedInterval" class="adm-select">
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                </select>
              </label>
              <button class="btn btn-secondary btn-sm" type="button" data-nl-action="schedule"><i class="ph ph-calendar-check" aria-hidden="true"></i> Schedule</button>
            </div>
          </details>
        </form>
        <p id="nlStatus" class="adm-status" role="status" aria-live="polite"></p>
      </div>
    `;
  }

  function queueRow(n) {
    const canCancel = n.status === 'scheduled';
    return `
      <div class="adm-content-workflow-row" data-nl-row="${esc(n.id)}">
        <div class="adm-panel-header">
          <span><b>${esc(n.subject)}</b> ${statusBadge(n.status)} <span class="pill">${esc(n.source === 'blog_post' ? 'Blog post' : 'Compose')}</span></span>
          <span class="muted">${esc(Number(n.recipient_count || 0).toLocaleString())} sent · ${esc(nextRunText(n))}</span>
        </div>
        <div class="adm-inline-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-nl-edit="${esc(n.id)}"><i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit</button>
          ${canCancel ? `<button class="btn btn-ghost btn-sm" type="button" data-nl-cancel="${esc(n.id)}"><i class="ph ph-x-circle" aria-hidden="true"></i> Cancel schedule</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-nl-delete="${esc(n.id)}"><i class="ph ph-trash" aria-hidden="true"></i> Delete</button>
        </div>
      </div>
    `;
  }

  function queueTemplate() {
    const rows = state.newsletters || [];
    return `
      <div class="adm-card">
        <div class="adm-panel-header">
          <div><h2>Drafts &amp; queue</h2><p class="muted">Edit, schedule, cancel, or delete. Scheduled and recurring sends run automatically.</p></div>
        </div>
        <div id="nlQueueList">${rows.length ? rows.map(queueRow).join('') : admEmpty('ph-envelope-simple', 'No newsletters yet', 'Compose a draft to get started.')}</div>
      </div>
    `;
  }

  function settingsTemplate() {
    const auto = Boolean(state.nlSettings?.auto_send_latest_blog);
    return `
      <div class="adm-card">
        <h2>Settings</h2>
        <label class="adm-content-check"><input type="checkbox" id="nlAutoSend"${auto ? ' checked' : ''}> Automatically email the latest blog post to subscribers on publish</label>
        <p id="nlSettingsStatus" class="adm-status" role="status" aria-live="polite"></p>
      </div>
    `;
  }

  function setupBanner() {
    if (state.nlSetupReady !== false) return '';
    return '<p class="adm-status" data-state="warn" style="margin-bottom:12px">Newsletter storage isn’t set up yet. Apply <code>supabase/schema-newsletters.sql</code>, then reload. Composing + preview work now; saving, sending and recipients need the tables.</p>';
  }

  function renderSection() {
    const body = box()?.querySelector('[data-nl-body]');
    if (!body) return;
    const section = state.nlSection || 'compose';
    const banner = setupBanner();
    if (section === 'compose') {
      body.innerHTML = banner + composeTemplate();
      populateEditor(editingCache());
      updatePreview();
      applySourceVisibility();
      applyScheduleVisibility();
    } else if (section === 'queue') {
      body.innerHTML = banner + queueTemplate();
    } else if (section === 'recipients') {
      body.innerHTML = banner + recipientsTemplate();
      loadRecipients();
    } else {
      body.innerHTML = banner + settingsTemplate();
    }
  }

  function recipientsTemplate() {
    return `
      <div class="adm-card">
        <div class="adm-panel-header"><h3>Recipients</h3></div>
        <p class="adm-status" id="nlRecipCounts"></p>
        <div class="nl-recip-import">
          <label class="full">Import emails (paste a list, CSV, or newline-separated)
            <textarea class="adm-textarea" id="nlRecipImport" rows="3" placeholder="a@x.com, b@x.com…"></textarea>
          </label>
          <button class="btn btn-secondary btn-sm" type="button" data-nl-recip="import"><i class="ph ph-upload-simple" aria-hidden="true"></i> Import</button>
        </div>
        <div class="nl-recip-add" style="margin-top:10px">
          <input class="adm-input" id="nlRecipEmail" type="email" placeholder="add one: email@company.com">
          <input class="adm-input" id="nlRecipName" type="text" placeholder="Name (optional)">
          <button class="btn btn-ghost btn-sm" type="button" data-nl-recip="add"><i class="ph ph-plus" aria-hidden="true"></i> Add</button>
        </div>
        <div id="nlRecipList" style="margin-top:14px">${admSkeleton()}</div>
      </div>`;
  }

  async function loadRecipients() {
    try {
      const res = await api('/api/admin/recipients');
      const c = res.counts || {};
      const counts = $('nlRecipCounts');
      if (counts) counts.textContent = `Live populations — users: ${c.users || 0} · leads: ${c.leads || 0} · imported/manual: ${c.imported || 0}`;
      const list = $('nlRecipList');
      if (!list) return;
      const rows = res.recipients || [];
      if (!rows.length) { list.innerHTML = admEmpty('ph-address-book', 'No imported recipients', 'Users + website leads still receive newsletters; add or import extra addresses here.'); return; }
      list.innerHTML = `<table class="adm-table"><thead><tr><th>Email</th><th>Name</th><th>Source</th><th>Subscribed</th><th></th></tr></thead><tbody>${rows.map((r) => `
        <tr>
          <td>${esc(r.email)}</td><td>${esc(r.name || '')}</td><td>${esc(r.source || '')}</td>
          <td><input type="checkbox" data-nl-recip-sub="${esc(r.email)}"${r.subscribed ? ' checked' : ''}></td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-nl-recip-remove="${esc(r.email)}"><i class="ph ph-trash" aria-hidden="true"></i></button></td>
        </tr>`).join('')}</tbody></table>`;
    } catch { const list = $('nlRecipList'); if (list) list.innerHTML = '<p class="adm-status" data-state="err">Could not load recipients.</p>'; }
  }

  async function recipAction(action, payload) {
    // api() JSON.stringifies the body itself — pass a raw object, not a string.
    try { await api('/api/admin/recipients', { method: 'POST', body: { action, ...payload } }); loadRecipients(); }
    catch (err) { message?.(`Recipient ${action} failed: ${err.message || err}`, 'err'); }
  }

  // The in-progress editor form is rebuilt on every section switch/render — cache
  // the last-populated newsletter object so switching queue -> compose -> queue
  // doesn't lose an in-progress edit.
  let editorEntry = {};
  function editingCache() { return editorEntry; }

  function showSection(section) {
    state.nlSection = section;
    const root = box();
    root?.querySelectorAll('[data-nl-section]').forEach((btn) => {
      const on = btn.dataset.nlSection === section;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    renderSection();
  }

  function readAudience() {
    const populations = POPULATIONS.filter(([, inputId]) => $(inputId)?.checked).map(([pop]) => pop);
    return { populations, recipient_tags: [] };
  }

  function writeAudience(audience = {}) {
    const populations = new Set(audience.populations || []);
    POPULATIONS.forEach(([pop, inputId]) => { const el = $(inputId); if (el) el.checked = populations.has(pop); });
  }

  function populateEditor(entry = {}) {
    editorEntry = entry || {};
    editingId = entry.id || null;
    if (!$('nlId')) return; // compose section not mounted right now
    $('nlId').value = entry.id || '';
    $('nlSource').value = entry.source === 'blog_post' ? 'blog_post' : 'compose';
    $('nlSubject').value = entry.subject || '';
    $('nlBody').value = entry.body_md || '';
    writeAudience(entry.audience || {});
    const heading = $('nlEditorHeading');
    if (heading) heading.textContent = entry.id ? 'Edit newsletter' : 'New newsletter';
    if (entry.source === 'blog_post' && entry.blog_slug) {
      void ensureBlogPosts().then(() => { const sel = $('nlBlogPick'); if (sel) sel.value = entry.blog_slug; });
    }
    const mode = entry.schedule?.mode === 'recurring' ? 'recurring' : 'once';
    if ($('nlSchedMode')) $('nlSchedMode').value = mode;
    if ($('nlSchedAt')) $('nlSchedAt').value = dateTimeLocalValue(entry.schedule?.next_run_at || entry.schedule?.send_at || '');
    if ($('nlSchedInterval') && entry.schedule?.interval_days) $('nlSchedInterval').value = String(entry.schedule.interval_days);
    setStatus('');
  }

  function resetEditor() {
    populateEditor({});
    applySourceVisibility();
    applyScheduleVisibility();
    updatePreview();
  }

  function setStatus(text, kind = '') { message('nlStatus', text, kind); }

  function updatePreview() {
    const el = $('nlPreview');
    if (!el) return;
    el.innerHTML = renderNewsletterBody($('nlBody')?.value || '');
  }

  function applySourceVisibility() {
    const isBlog = $('nlSource')?.value === 'blog_post';
    const wrap = $('nlBlogPickWrap');
    if (wrap) wrap.hidden = !isBlog;
    if (isBlog) void ensureBlogPosts();
  }

  function applyScheduleVisibility() {
    const recurring = $('nlSchedMode')?.value === 'recurring';
    if ($('nlSchedIntervalWrap')) $('nlSchedIntervalWrap').hidden = !recurring;
  }

  async function ensureBlogPosts() {
    const sel = $('nlBlogPick');
    if (!sel) return;
    if (blogPosts) { paintBlogOptions(sel); return; }
    try {
      const res = await fetch('/data/content/blog.json', { cache: 'no-store' });
      const data = res.ok ? await res.json() : {};
      blogPosts = data.blog_posts || [];
    } catch { blogPosts = []; }
    paintBlogOptions(sel);
  }

  function paintBlogOptions(sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">Choose a post…</option>' + (blogPosts || [])
      .map((p) => `<option value="${esc(p.slug)}">${esc(p.title)}</option>`).join('');
    if (current) sel.value = current;
  }

  function applyBlogPrefill(slug) {
    const post = (blogPosts || []).find((p) => p.slug === slug);
    if (!post) return;
    if ($('nlSubject')) $('nlSubject').value = post.title || '';
    if ($('nlBody')) {
      $('nlBody').value = `${post.excerpt || ''}\n\n[Read the full post](https://masest.co/blog/${post.slug})`;
    }
    updatePreview();
  }

  async function loadCounts() {
    try {
      const res = await api('/api/admin/recipients');
      counts = res.counts || { users: 0, leads: 0, imported: 0 };
    } catch { /* best-effort — audience picker still works without live counts */ }
    POPULATIONS.forEach(([pop, , countId]) => badge(countId, counts[pop] || 0));
  }

  async function renderNewsletter({ refetch = true } = {}) {
    const root = box();
    if (!root) return;
    if (!mounted) {
      root.innerHTML = shellTemplate();
      mounted = true;
    }
    if (refetch) {
      root.querySelector('[data-nl-body]').innerHTML = admSkeleton();
      try {
        const res = await api('/api/admin/newsletters');
        state.newsletters = res.newsletters || [];
        state.nlSettings = res.settings || { auto_send_latest_blog: false };
        state.nlSetupReady = res.setup_ready !== false;
        state.loaded.add('newsletter');
      } catch {
        root.querySelector('[data-nl-body]').innerHTML = '<p class="adm-status" data-state="err">Could not load newsletters. Reload to retry.</p>';
        return;
      }
    }
    renderSection();
    void loadCounts();
  }

  async function saveDraft() {
    const subject = $('nlSubject').value.trim();
    if (!subject) { setStatus('Enter a subject.', 'err'); return null; }
    const body = {
      action: 'save',
      id: editingId || undefined,
      subject,
      body_md: $('nlBody').value,
      source: $('nlSource').value === 'blog_post' ? 'blog_post' : 'compose',
      blog_slug: $('nlSource').value === 'blog_post' ? ($('nlBlogPick')?.value || '') : '',
      audience: readAudience(),
    };
    setStatus('Saving...');
    try {
      const res = await api('/api/admin/newsletters', { method: 'POST', body });
      editingId = res.id;
      $('nlId').value = res.id;
      editorEntry = { ...editorEntry, ...body, id: res.id };
      setStatus('Draft saved.', 'ok');
      await renderNewsletter({ refetch: true });
      return res.id;
    } catch (err) {
      setStatus(err.data?.error || 'Could not save the draft. Retry.', 'err');
      return null;
    }
  }

  async function sendTest() {
    const subject = $('nlSubject').value.trim();
    const bodyMd = $('nlBody').value;
    if (!subject) { setStatus('Enter a subject before sending a test.', 'err'); return; }
    const to = await promptTestEmail();
    if (to === null) return;
    setStatus('Sending test...');
    try {
      await api('/api/admin/newsletters', { method: 'POST', body: { action: 'test_send', to: to || undefined, subject, body_md: bodyMd } });
      setStatus('Test email sent.', 'ok');
    } catch (err) {
      setStatus(err.data?.error || 'Could not send the test email. Retry.', 'err');
    }
  }

  async function sendNow() {
    const audience = readAudience();
    if (!audience.populations.length) { setStatus('Choose at least one audience population.', 'err'); return; }
    const estimate = audience.populations.reduce((sum, pop) => sum + Number(counts[pop] || 0), 0);
    const ok = await confirmDialog(
      `Send to ${audience.populations.length} population(s) (about ${estimate.toLocaleString()} recipients)? This cannot be undone.`,
      { confirmText: 'Send now', danger: true },
    );
    if (!ok) return;
    const id = await saveDraft();
    if (!id) return;
    setStatus('Sending...');
    try {
      const res = await api('/api/admin/newsletters', { method: 'POST', body: { action: 'send_now', id } });
      setStatus(`Sent to ${res.sent} of ${res.audience} recipients.`, 'ok');
      await renderNewsletter({ refetch: true });
    } catch (err) {
      setStatus(err.data?.error || 'Could not send the newsletter. Retry.', 'err');
    }
  }

  async function schedule() {
    const id = editingId || await saveDraft();
    if (!id) return;
    const mode = $('nlSchedMode').value === 'recurring' ? 'recurring' : 'once';
    const sendAt = $('nlSchedAt').value ? new Date($('nlSchedAt').value).toISOString() : new Date().toISOString();
    const body = {
      action: 'schedule',
      id,
      schedule: mode === 'recurring'
        ? { mode, interval_days: Number($('nlSchedInterval').value) || 14, send_at: sendAt }
        : { mode, send_at: sendAt },
    };
    setStatus('Scheduling...');
    try {
      await api('/api/admin/newsletters', { method: 'POST', body });
      setStatus('Newsletter scheduled.', 'ok');
      await renderNewsletter({ refetch: true });
    } catch (err) {
      setStatus(err.data?.error || 'Could not schedule the newsletter. Retry.', 'err');
    }
  }

  async function editNewsletter(id) {
    state.nlSection = 'compose';
    showSection('compose');
    setStatus('Loading...');
    try {
      const res = await api(`/api/admin/newsletters?id=${encodeURIComponent(id)}`);
      if (!res.newsletter) { setStatus('That newsletter could not be found.', 'err'); return; }
      populateEditor(res.newsletter);
      applySourceVisibility();
      applyScheduleVisibility();
      updatePreview();
    } catch (err) {
      setStatus(err.data?.error || 'Could not load the newsletter. Retry.', 'err');
    }
  }

  async function deleteNewsletter(id) {
    if (!(await confirmDialog('Delete this newsletter? This cannot be undone.', { confirmText: 'Delete', danger: true }))) return;
    try {
      await api('/api/admin/newsletters', { method: 'POST', body: { action: 'delete', id } });
      if (editingId === id) resetEditor();
      await renderNewsletter({ refetch: true });
    } catch (err) { message('nlStatus', err.data?.error || 'Could not delete. Retry.', 'err'); }
  }

  async function cancelSchedule(id) {
    try {
      await api('/api/admin/newsletters', { method: 'POST', body: { action: 'cancel', id } });
      await renderNewsletter({ refetch: true });
    } catch (err) { message('nlStatus', err.data?.error || 'Could not cancel the schedule. Retry.', 'err'); }
  }

  async function saveSettings(checked) {
    try {
      await api('/api/admin/newsletters', { method: 'POST', body: { action: 'settings', auto_send_latest_blog: checked } });
      state.nlSettings = { ...state.nlSettings, auto_send_latest_blog: checked };
      message('nlSettingsStatus', 'Settings saved.', 'ok');
    } catch (err) {
      message('nlSettingsStatus', err.data?.error || 'Could not save settings. Retry.', 'err');
    }
  }

  function wireNewsletter() {
    const root = box();
    if (!root) return;
    delegate(root, 'click', '[data-nl-section]', (event, btn) => showSection(btn.dataset.nlSection));
    delegate(root, 'change', '#nlSource', applySourceVisibility);
    delegate(root, 'change', '#nlSchedMode', applyScheduleVisibility);
    delegate(root, 'input', '#nlBody', updatePreview);
    delegate(root, 'change', '#nlBlogPick', (event, sel) => applyBlogPrefill(sel.value));
    delegate(root, 'click', '#nlInsertImage', async () => {
      const ta = $('nlBody');
      if (!ta) return;
      const details = await promptImageDetails();
      if (!details) return;
      const md = `![${details.alt}](${details.url})`;
      const start = Number.isInteger(ta.selectionStart) ? ta.selectionStart : ta.value.length;
      const end = Number.isInteger(ta.selectionEnd) ? ta.selectionEnd : ta.value.length;
      ta.value = ta.value.slice(0, start) + md + ta.value.slice(end);
      const caret = start + md.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      updatePreview();
    });
    delegate(root, 'click', '[data-nl-action="new"]', () => resetEditor());
    delegate(root, 'click', '[data-nl-action="save"]', () => saveDraft());
    delegate(root, 'click', '[data-nl-action="test_send"]', () => sendTest());
    delegate(root, 'click', '[data-nl-action="send_now"]', () => sendNow());
    delegate(root, 'click', '[data-nl-action="schedule"]', () => schedule());
    delegate(root, 'click', '[data-nl-edit]', (event, btn) => editNewsletter(btn.dataset.nlEdit));
    delegate(root, 'click', '[data-nl-delete]', (event, btn) => deleteNewsletter(btn.dataset.nlDelete));
    delegate(root, 'click', '[data-nl-cancel]', (event, btn) => cancelSchedule(btn.dataset.nlCancel));
    delegate(root, 'change', '#nlAutoSend', (event, el) => saveSettings(el.checked));
    delegate(root, 'click', '[data-nl-recip="import"]', () => {
      const ta = $('nlRecipImport');
      const csv = ta?.value.trim();
      if (!csv) return;
      recipAction('import', { csv });
      if (ta) ta.value = '';
    });
    delegate(root, 'click', '[data-nl-recip="add"]', () => {
      const email = $('nlRecipEmail')?.value.trim();
      const name = $('nlRecipName')?.value.trim();
      if (!email) return;
      recipAction('add', { email, name });
      if ($('nlRecipEmail')) $('nlRecipEmail').value = '';
      if ($('nlRecipName')) $('nlRecipName').value = '';
    });
    delegate(root, 'change', '[data-nl-recip-sub]', (event, el) => recipAction('update', { email: el.dataset.nlRecipSub, subscribed: el.checked }));
    delegate(root, 'click', '[data-nl-recip-remove]', async (event, btn) => {
      if (await confirmDialog(`Remove ${btn.dataset.nlRecipRemove} from recipients?`, { confirmText: 'Remove', danger: true })) {
        recipAction('remove', { email: btn.dataset.nlRecipRemove });
      }
    });
  }

  return { renderNewsletter, wireNewsletter };
}

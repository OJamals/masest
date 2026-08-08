// Admin Reviews moderation tab (#36 per-tab split pattern, plan Task 13). Lists
// product_reviews for approve/reject/edit/delete against /api/admin/reviews, plus
// manual staff-entered reviews that are not purchase-verified.
// Shared primitives ($, api, state, message, admSkeleton, admEmpty) and the
// admin-local statusBadge / badge helpers are injected; esc/confirmDialog/delegate/
// dateTime come from util.js — mirrors js/admin/threads.js + js/admin/orders.js.
import { esc, confirmDialog, delegate, dateTime as date } from '../util.js?v=20260808a';

export function createReviewsTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge }) {
  // Filled stars in accent ink, unfilled dimmed via opacity — avoids relying on the
  // outline-star glyph rendering consistently across fonts.
  function stars(n) {
    const r = Math.max(0, Math.min(5, Number(n) || 0));
    return `<span class="rv-stars" aria-label="${r} out of 5 stars" title="${r}/5">${'★'.repeat(r)}<span style="opacity:.35">${'★'.repeat(5 - r)}</span></span>`;
  }

  function excerpt(text, max = 140) {
    const s = String(text || '').trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  // Best-effort pending-count badge for the nav pill — a separate call from the list
  // fetch (the list may be scoped to a different filter) so the badge always reflects
  // the true pending queue, matching the plan's "fetch ?status=pending, badge=length".
  async function refreshReviewsBadge() {
    try {
      const res = await api('/api/admin/reviews?status=pending');
      badge('aBadgeReviews', (res.reviews || []).length);
    } catch { /* best-effort; the list render below surfaces real load errors */ }
  }

  async function renderReviews({ refetch = true } = {}) {
    const box = $('admReviews');
    if (!box) return;
    const status = $('rvFilter')?.value || 'pending';
    if (refetch) {
      box.innerHTML = admSkeleton();
      try {
        state.reviews = (await api(`/api/admin/reviews?status=${encodeURIComponent(status)}`)).reviews || [];
        state.loaded.add('reviews');
        refreshReviewsBadge();
      } catch {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load reviews. Reload to retry.</p>';
        return;
      }
    }
    const reviews = state.reviews || [];
    if (!reviews.length) {
      box.innerHTML = admEmpty('ph-star', 'No reviews', status === 'pending' ? 'New reviews awaiting moderation appear here.' : 'No reviews match this filter.');
      return;
    }
    // Moderation is a batch job: a queue of pending reviews is read once and
    // dispositioned together, so selection + one apply beats two clicks per row.
    const bulkBar = `<div class="adm-tools adm-tools-flush" data-capability-scope="admin.write">
      <label class="admin-select-all"><input type="checkbox" id="rvAll" aria-label="Select all reviews"> Select all</label>
      <button class="btn btn-ghost btn-sm" data-review-bulk="approve" type="button">Approve selected</button>
      <button class="btn btn-ghost btn-sm" data-review-bulk="reject" type="button">Reject selected</button>
    </div>`;
    box.innerHTML = bulkBar + reviews.map((r) => {
      const id = esc(r.id);
      return `<article class="quote-item" data-review-id="${id}" data-capability-scope="admin.write">
        <div class="dash-row">
          <span><label class="admin-select-all"><input type="checkbox" class="rv-check" value="${id}" aria-label="Select review by ${esc(r.author_name || 'anonymous')}"></label> <b>${esc(r.kind)}:${esc(r.sku)}</b> ${stars(r.rating)} ${statusBadge(r.status)}</span>
          <span class="muted">${esc(date(r.created_at))}</span>
        </div>
        <p class="muted" style="margin:4px 0">
          ${esc(r.author_name || 'Anonymous')}
          ${r.verified_purchase ? statusBadge('verified') : ''}
          <span class="pill">${esc(r.source || 'storefront')}</span>
        </p>
        ${r.title ? `<p><b>${esc(r.title)}</b></p>` : ''}
        <p>${esc(excerpt(r.body))}</p>
        <div class="adm-inline-actions">
          <button class="btn btn-ghost btn-sm" data-review-approve="${id}" type="button" ${r.status === 'approved' ? 'disabled' : ''}>Approve</button>
          <button class="btn btn-ghost btn-sm" data-review-reject="${id}" type="button" ${r.status === 'rejected' ? 'disabled' : ''}>Reject</button>
          <button class="btn btn-ghost btn-sm" data-review-delete="${id}" type="button">Delete</button>
        </div>
        <details class="adm-track">
          <summary>Edit</summary>
          <div class="adm-track-controls">
            <input class="adm-input" data-review-edit-author="${id}" value="${esc(r.author_name || '')}" placeholder="Author name" aria-label="Edit author name">
            <input class="adm-input admin-input-wide" data-review-edit-title="${id}" value="${esc(r.title || '')}" placeholder="Title" aria-label="Edit title">
            <textarea class="adm-textarea" data-review-edit-body="${id}" placeholder="Body" aria-label="Edit body">${esc(r.body || '')}</textarea>
            <button class="btn btn-ghost btn-sm" data-review-save="${id}" type="button">Save edit</button>
          </div>
        </details>
      </article>`;
    }).join('');
  }

  // Row actions delegated once on the stable #admReviews container (#36). Any
  // mutation refetches — approve/reject move a row out of whichever filter is
  // active, so an in-place patch (like companies/orders) would leave a stale row.
  function wireReviews() {
    const box = $('admReviews');
    if (!box) return;
    delegate(box, 'change', '#rvAll', (event, all) => {
      box.querySelectorAll('.rv-check').forEach((check) => { check.checked = all.checked; });
    });
    delegate(box, 'click', '[data-review-bulk]', async (event, button) => {
      const action = button.dataset.reviewBulk;
      const ids = [...box.querySelectorAll('.rv-check:checked')].map((check) => check.value);
      if (!ids.length) { message('rvStatus', 'Select at least one review.', 'err'); return; }
      button.disabled = true;
      try {
        const res = await api('/api/admin/reviews', { method: 'POST', body: { action, ids } });
        message('rvStatus', `${action === 'approve' ? 'Approved' : 'Rejected'} ${res.updated ?? ids.length} review(s).`, 'ok');
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvStatus', err.data?.error || `Could not ${action} the selected reviews. Retry.`, 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-review-approve]', async (event, button) => {
      const id = button.dataset.reviewApprove;
      button.disabled = true;
      try {
        await api('/api/admin/reviews', { method: 'POST', body: { action: 'approve', id } });
        message('rvStatus', 'Review approved.', 'ok');
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvStatus', err.data?.error || 'Could not approve the review. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-review-reject]', async (event, button) => {
      const id = button.dataset.reviewReject;
      button.disabled = true;
      try {
        await api('/api/admin/reviews', { method: 'POST', body: { action: 'reject', id } });
        message('rvStatus', 'Review rejected.', 'ok');
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvStatus', err.data?.error || 'Could not reject the review. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-review-delete]', async (event, button) => {
      const id = button.dataset.reviewDelete;
      if (!(await confirmDialog('Delete this review? This cannot be undone.', { confirmText: 'Delete', danger: true }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/reviews', { method: 'POST', body: { action: 'delete', id } });
        message('rvStatus', 'Review deleted.', 'ok');
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvStatus', err.data?.error || 'Could not delete the review. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-review-save]', async (event, button) => {
      const id = button.dataset.reviewSave;
      const author_name = box.querySelector(`[data-review-edit-author="${CSS.escape(id)}"]`)?.value.trim();
      const title = box.querySelector(`[data-review-edit-title="${CSS.escape(id)}"]`)?.value.trim();
      const bodyText = box.querySelector(`[data-review-edit-body="${CSS.escape(id)}"]`)?.value.trim();
      button.disabled = true;
      try {
        await api('/api/admin/reviews', { method: 'POST', body: { action: 'edit', id, author_name, title, body: bodyText } });
        message('rvStatus', 'Review updated.', 'ok');
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvStatus', err.data?.error || 'Could not save the edit. Retry.', 'err');
        button.disabled = false;
      }
    });
  }

  function wireManualReviewForm() {
    const form = $('rvManualForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const sku = $('rvSku').value.trim();
      const authorName = $('rvAuthor').value.trim();
      const authorEmail = $('rvAuthorEmail').value.trim();
      if (!sku) { message('rvManualStatus', 'Enter a SKU.', 'err'); return; }
      if (!authorName) { message('rvManualStatus', 'Enter the customer name.', 'err'); return; }
      if (!authorEmail) { message('rvManualStatus', 'Enter the customer email.', 'err'); return; }
      message('rvManualStatus', 'Adding…');
      try {
        await api('/api/admin/reviews', {
          method: 'POST',
          body: {
            action: 'create_manual',
            kind: $('rvKind').value,
            sku,
            rating: Number($('rvRating').value),
            author_name: authorName,
            author_email: $('rvAuthorEmail').value.trim(),
            title: $('rvTitle').value.trim(),
            body: $('rvBody').value.trim(),
          },
        });
        message('rvManualStatus', 'Review added.', 'ok');
        ['rvSku', 'rvAuthor', 'rvAuthorEmail', 'rvTitle', 'rvBody'].forEach((id) => { $(id).value = ''; });
        await renderReviews({ refetch: true });
      } catch (err) {
        message('rvManualStatus', err.data?.error || 'Could not add the review. Retry.', 'err');
      }
    });
  }

  return { renderReviews, wireReviews, wireManualReviewForm, refreshReviewsBadge };
}

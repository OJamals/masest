// Admin offers tab (#36 per-tab split). Sends broadcast offers to accounts and
// lists past sends. Self-caches via state.loaded (force-refreshes after a send).
// Shared primitives + message are injected; esc/date come from the shared util.
import { esc, confirmDialog, dateTime as date } from '../util.js?v=20260711q';

export function createOffersTab({ $, api, state, message, admSkeleton, admEmpty }) {
  async function renderOffers(force = false) {
    if (state.loaded.has('offers') && !force) return;
    const box = $('admOffers');
    box.innerHTML = admSkeleton();
    try {
      const offers = (await api('/api/admin/offers')).offers || [];
      box.innerHTML = offers.length ? offers.map((offer) => `
      <div class="quote-item"><b>${esc(offer.title)}</b><p class="muted">${esc(offer.audience)} | ${esc(offer.recipients || 0)} recipients | ${esc(date(offer.created_at))}</p></div>
    `).join('') : admEmpty('ph-envelope-simple', 'No sends yet', 'Broadcast offers you send appear here.');
      state.loaded.add('offers');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load sends. Reload to retry.</p>';
    }
  }

  function wireOfferForm() {
    $('offerForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const audience = $('ofAud').value;
      const withEmail = $('ofEmail').checked;
      // Mass, irreversible send — the only bulk outbound action in the admin; confirm like refunds do.
      if (!(await confirmDialog(`Send this offer to ${audience || 'all'} accounts${withEmail ? ' and email them' : ''}?`, { confirmText: 'Send offer' }))) return;
      message('offerStatus', 'Sending...');
      try {
        const response = await api('/api/admin/offers', {
          method: 'POST',
          body: {
            title: $('ofTitle').value.trim(),
            body: $('ofBody').value.trim(),
            cta_url: $('ofCta').value.trim() || '/products.html',
            audience: $('ofAud').value,
            send_email: $('ofEmail').checked,
          },
        });
        message('offerStatus', `Sent to ${response.recipients || 0} account(s)${response.emailed ? ' + email' : ''}.`, 'ok');
        renderOffers(true);
      } catch (err) {
        message('offerStatus', err.data?.error || 'Could not send the offer. Retry.', 'err');
      }
    });
  }

  return { renderOffers, wireOfferForm };
}

// Admin offers tab (#36 per-tab split). Sends broadcast offers to accounts and
// lists past sends. Self-caches via state.loaded (force-refreshes after a send).
// Shared primitives + message are injected; esc/date come from the shared util.
import { esc, dateTime as date } from '../util.js';

export function createOffersTab({ $, api, state, message, admSkeleton }) {
  async function renderOffers(force = false) {
    if (state.loaded.has('offers') && !force) return;
    const box = $('admOffers');
    box.innerHTML = admSkeleton();
    try {
      const offers = (await api('/api/admin/offers')).offers || [];
      box.innerHTML = offers.length ? offers.map((offer) => `
      <div class="quote-item"><b>${esc(offer.title)}</b><p class="muted">${esc(offer.audience)} | ${esc(offer.recipients || 0)} recipients | ${esc(date(offer.created_at))}</p></div>
    `).join('') : '<p class="muted">No sends yet.</p>';
      state.loaded.add('offers');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load sends. Reload to retry.</p>';
    }
  }

  function wireOfferForm() {
    $('offerForm').addEventListener('submit', async (event) => {
      event.preventDefault();
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

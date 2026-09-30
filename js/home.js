// Homepage conversion choices use the existing privacy-limited event transport.
const home = document.querySelector('body.home-unveiling main');
const actions = new Map([
  ['products', 'home_product_click'],
  ['hvac', 'home_job_click'],
  ['rust_scale', 'home_job_click'],
  ['grease_grime', 'home_job_click'],
  ['exterior', 'home_job_click'],
  ['water', 'home_job_click'],
  ['advice', 'home_advice_click'],
  ['bulk', 'home_quote_click'],
  ['private_label', 'home_private_label_click'],
]);
const placements = new Set(['hero', 'jobs', 'private_label', 'close']);

home?.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[data-home-action]') : null;
  if (!link || !home.contains(link) || typeof window.mtrack !== 'function') return;
  const { homeAction: action, homePlacement: placement } = link.dataset;
  if (!actions.has(action) || !placements.has(placement)) return;
  try {
    const detail = { source: `home_${placement}_${action}` };
    if (action === 'private_label') detail.request_type = 'private-label';
    else if (action === 'advice' || action === 'bulk') detail.request_type = 'quote';
    window.mtrack(actions.get(action), detail);
  } catch { /* Analytics must never interrupt navigation. */ }
});

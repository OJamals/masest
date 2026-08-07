/* MASEST staff-console chrome.
 *
 * The public site chrome (js/main/chrome.js) renders the storefront nav, the
 * cart, the lead-action bar, and the full marketing footer. On the admin console
 * that furniture cost ~920px of vertical space per page (59px nav + an 861px
 * footer of product-category links and a newsletter signup) and put a shopping
 * cart on an operations tool. The console renders its own chrome instead:
 * a skip link, one compact staff bar, and no footer.
 *
 * Deliberately kept here rather than as a `variant` on main/chrome.js: that
 * module is imported by every public page through js/main.js, so editing it
 * would force a site-wide STYLE_VERSION cache-bust across ~72 HTML files.
 */

export function renderAdminChrome({ onSignOut } = {}) {
  document.querySelector('.nojs-nav')?.setAttribute('hidden', '');

  const skip = document.querySelector('.skip-link[href="#main"]') || document.createElement('a');
  skip.classList.add('skip-link');
  skip.href = '#main';
  if (!skip.textContent.trim()) skip.textContent = 'Skip to content';

  // Reuses .nav / .nav-inner / .nav-actions so the shared elevation and account
  // -control styles still apply; .adm-chrome trims it to the staff layout.
  const bar = document.createElement('header');
  bar.className = 'nav adm-chrome';
  bar.innerHTML = `
    <div class="nav-inner adm-chrome-inner">
      <a class="nav-logo" href="/" aria-label="MASEST home"><img class="logo-image logo-ink" src="/img/masest-logo-ink.png" alt="MASEST" width="469" height="585"></a>
      <span class="adm-chrome-label">Staff console</span>
      <div class="adm-chrome-search"></div>
      <div class="nav-actions">
        <span class="adm-chrome-user" id="admChromeUser" hidden></span>
        <button class="btn btn-ghost btn-sm" id="admSignOut" type="button"><i class="ph ph-sign-out" aria-hidden="true"></i> Sign out</button>
      </div>
    </div>`;
  document.body.prepend(bar);
  document.body.prepend(skip);

  // Staff identity + sign out, rendered here rather than mounting the buyer
  // account nav: that dropdown links Orders / Addresses / Payment / Notifications
  // off the buyer account API, which the staff console must not carry.
  bar.querySelector('#admSignOut')?.addEventListener('click', () => onSignOut?.());

  let scrollRAF = 0;
  const applyScroll = () => {
    scrollRAF = 0;
    bar.classList.toggle('scrolled', window.scrollY > 8);
  };
  applyScroll();
  window.addEventListener('scroll', () => {
    if (!scrollRAF) scrollRAF = requestAnimationFrame(applyScroll);
  }, { passive: true });

  return bar;
}

/* Show which staff account the console is acting as (set once /api/admin/stats
   returns staff_context). */
export function setAdminChromeUser(email) {
  const el = document.getElementById('admChromeUser');
  if (!el) return;
  el.textContent = email || '';
  el.hidden = !email;
}

/* MASEST — buyer surfaces refuse to serve a staff account.
 *
 * Staff operate the store rather than shop it. The nav pass already said so — the
 * cart icon is hidden and the account dropdown lists Admin console / Customer
 * support instead of Dashboard / Orders / Business. But that only dressed the
 * chrome: typing /dashboard, /cart or /checkout still rendered the whole customer
 * workspace to an admin, cart and business tools included. The gate has to live on
 * the pages, so this module is the single place that decides who counts as staff
 * and what they see in place of a buyer surface.
 *
 * Deliberately not an access-control boundary — the buyer APIs are already scoped
 * to the caller's own account, so a staff member reading their own orders was never
 * a leak. This is product separation: staff get one workspace, buyers get another.
 *
 * Styles are injected here rather than added to a stylesheet so a buyer surface
 * needs one import and nothing else — same pattern as js/account-nav.js.
 */
import { esc } from './util.js';

/* The one definition of "staff" on the client. /api/account/me computes can_admin
 * from the staff email allowlist or an explicit is_staff + staff_role profile; the
 * client must not re-derive it from broader fields like the company role. */
export function isStaffAccount(account) {
  return account?.can_admin === true;
}

function injectStyle() {
  if (document.getElementById('staff-surface-style')) return;
  const s = document.createElement('style');
  s.id = 'staff-surface-style';
  s.textContent = `
  /* Sized by its host: inside the dashboard it sits above the account cards and has
     to match their width, so only the standalone page takeover gets centred. */
  .staff-surface { padding: 28px; border: 1px solid var(--line, #e4e6e9); border-radius: var(--r-card, 16px);
    background: var(--surface, #fff); box-shadow: var(--shadow-xs, 0 1px 2px rgba(0,0,0,.06)); }
  .staff-surface-standalone { max-width: 640px; margin: 0 auto; }
  .staff-surface .eyebrow { margin: 0 0 6px; }
  .staff-surface h2 { margin: 0 0 10px; }
  .staff-surface p { margin: 0 0 18px; }
  .staff-surface-actions { display: flex; flex-wrap: wrap; gap: 12px; }`;
  document.head.appendChild(s);
}

/* The replacement card. Both actions mirror the staff account menu: the admin
 * console, and the support console opened over the current page — data-support-open
 * is claimed by js/admin-support.js, and the href is a real fallback for routes
 * where that console suppresses itself. */
export function staffSurfaceNotice({ title, body, root = '' } = {}) {
  injectStyle();
  const el = document.createElement('div');
  el.className = 'staff-surface';
  el.innerHTML = `
    <p class="eyebrow">Staff account</p>
    <h2 class="headline">${esc(title)}</h2>
    <p class="muted">${esc(body)}</p>
    <div class="staff-surface-actions">
      <a class="btn btn-primary" href="${root}admin.html"><i class="ph ph-shield-check" aria-hidden="true"></i> Open admin console</a>
      <a class="btn btn-secondary" href="${root}admin.html#support" data-support-open><i class="ph ph-lifebuoy" aria-hidden="true"></i> Customer support</a>
    </div>`;
  return el;
}

/* Replace a whole buyer page (cart, checkout) with the notice. Takes over <main>
 * rather than hiding pieces of it, so nothing the page was mid-way through
 * rendering can flash behind or below the card. The section/wrap wrapper is what
 * gives the card the same vertical rhythm and gutters as every other page. */
export function replaceBuyerSurface(main, { title, body, root = '' } = {}) {
  if (!main) return null;
  const section = document.createElement('section');
  section.className = 'section';
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const notice = staffSurfaceNotice({ title, body, root });
  notice.classList.add('staff-surface-standalone');
  wrap.append(notice);
  section.append(wrap);
  main.replaceChildren(section);
  return section;
}

/* MASEST - account control injected into the site nav (.nav-actions).
 * Logged out: a "Sign in" button. Signed in: an account dropdown (Dashboard, Orders,
 * Messages, Notifications, Settings, Admin if staff, Sign out). Loaded by main.js after
 * the nav is built: import('js/account-nav.js').then(m => m.initAccountNav({ nav, root })). */
import { esc } from './util.js';
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Account';
// Lazy: only staff ever need this module's toggle/banner, and it's a tiny
// file — importing it eagerly for every signed-out visitor isn't worth it.
const staffSurfaceModule = () => import('./staff-surface.js?v=20260915a');

// Cheap logged-in check: Supabase persists its session under sb-<ref>-auth-token in localStorage.
// Lets anonymous visitors skip loading the Supabase SDK entirely (lighter marketing pages).
function hasSession() {
  try { return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('-auth-token')); }
  catch { return false; }
}

const MENU = [
  ['ph-squares-four', 'Dashboard', 'dashboard.html'],
  ['ph-briefcase', 'Business', 'dashboard.html#business'],
  ['ph-package', 'Orders', 'dashboard.html#orders'],
  ['ph-chat-circle', 'Messages', 'dashboard.html#messages'],
  ['ph-bell', 'Notifications', 'dashboard.html#notifications'],
];

const ACCOUNT_MENU = [
  ['ph-user', 'Profile & security', 'dashboard.html#profile'],
  ['ph-map-pin', 'Addresses & payment', 'dashboard.html#addresses'],
];

// Staff operate the store rather than shop it, so on public pages they get their
// own destinations instead of a buyer's Orders / Addresses / Notifications — and
// no cart. Password management stays, since staff still own their login.
// "Customer support" opens the support console over the page staff is already
// on — data-support-open is claimed by js/admin-support.js. The href is a real
// fallback, not decoration: on a route where the console suppresses itself the
// click is left alone and the browser navigates to the admin console instead.
const STAFF_MENU = [
  ['ph-shield-check', 'Admin console', 'admin.html'],
  ['ph-lifebuoy', 'Customer support', 'admin.html#support', 'data-support-open'],
];
const STAFF_ACCOUNT_MENU = [
  ['ph-user', 'Profile & security', 'dashboard.html#profile'],
];

function injectStyle() {
  if (document.getElementById('acct-nav-style')) return;
  const s = document.createElement('style');
  s.id = 'acct-nav-style';
  s.textContent = `
  .nav-account { display:flex; align-items:center; align-self:stretch; padding:0; }
  .nav-signin { display:inline-flex; align-items:center; gap:var(--s2,8px); padding:var(--s2,8px) var(--s4,16px); border-radius:var(--r-pill,999px);
    justify-content:center; align-self:center; min-height:44px; line-height:1; border:1.5px solid var(--line,#e4e6e9); font-weight:700; font-size:var(--fs-small,.875rem); color:var(--ink,#15171c); text-decoration:none; white-space:nowrap; }
  .nav-signin:hover { border-color:var(--ink,#15171c); }
  .nav.over-dark .nav-signin { color:#fff; border-color:rgba(255,255,255,.35); }
  .acct-dd { position:relative; }
  .acct-dd > summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:var(--s2,8px); padding:var(--s2,8px) var(--s3,12px) var(--s2,8px) var(--s2,8px);
    border-radius:var(--r-pill,999px); border:1.5px solid var(--line,#e4e6e9); font-weight:700; font-size:var(--fs-small,.875rem); color:var(--ink,#15171c); }
  .acct-dd > summary::-webkit-details-marker { display:none; }
  .acct-dd > summary:hover { border-color:var(--ink,#15171c); }
  .nav.over-dark .acct-dd > summary { color:#fff; border-color:rgba(255,255,255,.35); }
  .acct-avatar { position:relative; width:26px; height:26px; border-radius:50%; background:var(--accent,#0e7c86); color:#fff; display:grid; place-items:center; font-size:var(--fs-caption,.8125rem); font-weight:800; }
  .acct-notif-dot { position:absolute; top:-4px; right:-4px; min-width:15px; height:15px; padding:0 3px; border-radius:999px; background:var(--status-danger-ink,#b42318); color:#fff; font-size:var(--fs-micro,.75rem); font-weight:800; display:grid; place-items:center; line-height:1; box-shadow:0 0 0 2px var(--surface,#fff); }
  .nav.over-dark .acct-notif-dot { box-shadow:0 0 0 2px #0b0d12; }
  .acct-name { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .acct-dd-menu { position:absolute; inset-inline-end:0; left:auto; top:calc(100% + 10px); width:min(236px, calc(100vw - 16px)); max-width:calc(100vw - 16px); max-height:calc(100dvh - 88px); overflow:auto; overscroll-behavior:contain; background:var(--surface,#fff);
    border:1px solid var(--line,#e4e6e9); border-radius:var(--r-card,16px); box-shadow:0 18px 40px -16px rgba(0,0,0,.28); padding:var(--s2,8px); z-index:120; }
  .acct-menu-section { padding:var(--s1,4px) 0; }
  .acct-menu-section + .acct-menu-section { border-top:1px solid var(--line,#e4e6e9); margin-top:var(--s1,4px); padding-top:var(--s2,8px); }
  .acct-menu-label { display:block; padding:3px var(--s3,12px) var(--s2,8px); color:var(--ink-soft,#393d44); font-size:var(--fs-caption,.8125rem); font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
  .acct-dd-menu a, .acct-dd-menu button { display:flex; align-items:center; gap:var(--s3,12px); width:100%; text-align:left; padding:var(--s3,12px) var(--s3,12px);
    border:0; background:none; border-radius:10px; font:inherit; font-size:var(--fs-small,.875rem); font-weight:600; color:var(--ink,#15171c); text-decoration:none; cursor:pointer; }
  .acct-dd-menu a:hover, .acct-dd-menu button:hover { background:var(--accent-tint,#f1f8f8); color:var(--accent-ink,#0a5b62); }
  .acct-dd-menu i { font-size:1.15rem; color:var(--ink-soft,#393d44); }
  .acct-dd-menu a.has-unread { font-weight:800; }
  .acct-menu-count { margin-left:auto; min-width:20px; height:20px; padding:0 var(--s2,8px); border-radius:999px; background:var(--status-danger-ink,#b42318); color:#fff; font-size:var(--fs-micro,.75rem); font-weight:800; display:inline-grid; place-items:center; line-height:1; }
  .acct-menu-count[hidden] { display:none; }
  .acct-dd-menu .acct-signout { border-top:1px solid var(--line,#e4e6e9); margin-top:var(--s2,8px); padding-top:var(--s3,12px); color:var(--status-danger-ink,#b42318); }
  .acct-dd-menu .acct-admin { color:var(--accent-ink,#0a5b62); }
  /* Cart: transparent shopping-cart icon with a count bubble (replaces the "Cart" text pill).
     44, not 42: this style element is injected into <head> at runtime, so it lands after
     every linked sheet and is what actually sizes the cart button. css/style.css carries
     the same number as the no-JS fallback; changing only that one moves nothing. */
  .nav-cart { position:relative; display:inline-grid; place-items:center; width:44px; height:44px; border-radius:50%; background:transparent; color:var(--ink,#15171c); padding:0; }
  .nav-cart[hidden] { display: none; }
  .nav-cart:hover { background:rgba(0,0,0,.06); }
  .nav.over-dark .nav-cart { color:#fff; }
  .nav.over-dark .nav-cart:hover { background:rgba(255,255,255,.12); }
  .nav-cart i { font-size:1.45rem; line-height:1; }
  .nav-cart .cart-count { position:absolute; top:1px; right:1px; min-width:17px; height:17px; padding:0 var(--s1,4px); border-radius:999px;
    background:var(--accent,#0e7c86); color:#fff; font-size:var(--fs-micro,.75rem); font-weight:800; display:grid; place-items:center; line-height:1; box-shadow:0 0 0 2px var(--surface,#fff); }
  .nav.over-dark .nav-cart .cart-count { box-shadow:0 0 0 2px #0b0d12; }
  .nav-cart .cart-count[hidden] { display:none; }
  @media (max-width:860px){ .acct-name{ display:none; } }`;
  document.head.appendChild(s);
}

export async function initAccountNav({
  nav,
  root = '',
  authModule = './auth.js?v=20260915a',
  resolveSession = false,
} = {}) {
  const actions = (nav || document).querySelector('.nav-actions');
  if (!actions) return;
  injectStyle();
  await renderAccountNav(actions, root, authModule, resolveSession);
  // Re-render when auth state changes in-page (login / logout / finish setup) so the
  // header swaps "Sign in" for the account dropdown without a full page reload.
  if (!actions.dataset.authBound) {
    actions.dataset.authBound = '1';
    document.addEventListener('masest:auth', () => {
      renderAccountNav(actions, root, authModule, resolveSession).catch(() => {});
    });
  }
}

async function renderAccountNav(actions, root = '', authModule = './auth.js?v=20260915a', resolveSession = false) {
  // Replace whatever account control is present: the SSR placeholder (.nav-auth-placeholder,
  // rendered by chrome.js) on first render, or a previously-rendered control (.nav-account)
  // on a later auth-change re-render. Matching only one of these would leave the other behind,
  // showing both a "Sign in" button and the account control at once.
  const prev = actions.querySelector('.nav-account, .nav-auth-placeholder');

  // Marketing pages retain the cheap localStorage fast path. Authenticated app shells
  // can request an authoritative Supabase session check so chrome cannot disagree with
  // the page's authenticated API state during token restoration.
  let logout, api, data = null;
  let authResolved = true;
  // Set in the signed-in branch below; read afterward by the cart-icon and
  // dataset.accountKind assignments, which both need to reflect the buyer
  // preview override rather than the raw fetched account.
  let effectiveIsStaff = false;
  if (resolveSession || hasSession()) {
    try {
      const m = await import(authModule);
      logout = m.logout;
      api = m.api;
      let sessionExists = true;
      if (resolveSession) {
        const { data: sessionData, error } = await m.supabase.auth.getSession();
        if (error) throw error;
        sessionExists = Boolean(sessionData?.session);
      }
      if (sessionExists) data = await m.me();
    }
    catch { authResolved = false; }
  }

  // Keep chrome's neutral placeholder on transient auth/API failure. Rendering Sign in
  // here would claim a logged-in user is anonymous until another caller finishes refresh.
  if (!authResolved) return;

  const mount = document.createElement('div');
  mount.className = 'nav-account';

  if (!data) {
    mount.innerHTML = `<a class="nav-signin" href="${root}account.html"><i class="ph ph-sign-in" aria-hidden="true"></i> Sign in</a>`;
  } else if (data.needs_profile) {
    mount.innerHTML = `<a class="nav-signin" href="${root}account.html">Finish setup</a>`;
  } else {
    const label = data.profile?.full_name || data.company?.name || data.email || 'Account';
    // Ground truth vs. the buyer-preview override: realIsStaff decides whether the
    // toggle itself shows up (only a genuine staff account gets to flip it);
    // isStaff decides what the chrome renders, so a staff member mid-preview sees
    // exactly what a signed-in buyer would.
    const realIsStaff = data.can_admin === true;
    let previewing = false;
    let staffSurface = null;
    if (realIsStaff) {
      staffSurface = await staffSurfaceModule();
      previewing = staffSurface.isPreviewingAsBuyer();
    }
    const isStaff = realIsStaff && !previewing;
    effectiveIsStaff = isStaff;
    const accountMenu = isStaff ? STAFF_MENU : MENU;
    const items = accountMenu.map(([i, l, h, attr = '']) => {
      const isNotifications = l === 'Notifications';
      const marker = isNotifications ? ' data-account-nav-notifications' : '';
      const count = isNotifications ? '<span class="acct-menu-count" hidden>0</span>' : '';
      return `<a href="${root}${h}"${attr ? ` ${attr}` : ''}${marker}><i class="ph ${i}" aria-hidden="true"></i>${esc(l)}${count}</a>`;
    }).join('');
    const accountItems = (isStaff ? STAFF_ACCOUNT_MENU : ACCOUNT_MENU)
      .map(([i, l, h]) => `<a href="${root}${h}"><i class="ph ${i}" aria-hidden="true"></i>${esc(l)}</a>`).join('');
    // SQ-12: staff could not QA the buyer storefront without a second browser
    // profile. This toggle flips the client-only preview flag and reloads —
    // real staff only, gated on realIsStaff so a previewing buyer view never
    // grows its own copy of the control.
    const previewToggle = realIsStaff
      ? `<div class="acct-menu-section"><button type="button" class="acct-preview-toggle"><i class="ph ${previewing ? 'ph-eye-slash' : 'ph-eye'}" aria-hidden="true"></i>${previewing ? 'Exit buyer preview' : 'Preview as buyer'}</button></div>`
      : '';
    // Admin console now leads the staff list above, so the old separate row
    // above Sign out is gone.
    mount.innerHTML = `<details class="acct-dd">
      <summary aria-haspopup="true"><span class="acct-avatar">${esc((label[0] || 'A').toUpperCase())}</span><span class="acct-name">${esc(firstName(label))}</span><i class="ph ph-caret-down" aria-hidden="true"></i></summary>
      <div class="acct-dd-menu">
        <div class="acct-menu-section"><span class="acct-menu-label">${isStaff ? 'Staff' : 'Main'}</span>${items}</div>
        <div class="acct-menu-section"><span class="acct-menu-label">Account</span>${accountItems}</div>
        ${previewToggle}
        <div class="acct-menu-section"><button type="button" class="acct-signout"><i class="ph ph-sign-out" aria-hidden="true"></i>Sign out</button></div>
      </div>
    </details>`;
    if (realIsStaff) {
      mount.querySelector('.acct-preview-toggle').addEventListener('click', () => {
        staffSurface.setPreviewAsBuyer(!previewing);
        location.reload();
      });
    }
    if (previewing) staffSurface.mountPreviewBanner(root);
  }

  // Staff are running the store, not shopping it. Hidden rather than removed so a
  // re-render on auth change (sign out) can put it straight back. Reads
  // effectiveIsStaff (not the raw account) so a buyer preview shows the cart icon.
  const cart = actions.querySelector('.nav-cart');
  if (cart) cart.hidden = effectiveIsStaff;

  const burger = actions.querySelector('.nav-burger');
  if (prev) prev.replaceWith(mount);
  else actions.insertBefore(mount, burger || null);

  // Publish the resolved account kind so buyer controls can swap to staff work
  // without re-fetching account state in every feature module. This is UI state,
  // not an authorization boundary; APIs still enforce their own capabilities.
  // effectiveIsStaff already folds in the buyer-preview override.
  const accountKind = effectiveIsStaff ? 'staff' : data ? 'customer' : 'guest';
  document.documentElement.dataset.accountKind = accountKind;
  document.dispatchEvent(new CustomEvent('masest:account-role', { detail: { accountKind } }));

  // Unread notification badge on the avatar (non-blocking; signed-in full accounts only).
  // Not for staff: it counts a buyer's own order and message alerts, and staff have no
  // Notifications destination to open — theirs is the support console's own inbox.
  if (api && data?.company && !data.needs_profile && data.can_admin !== true) {
    api('/api/account/notifications').then(({ unread }) => {
      const av = mount.querySelector('.acct-avatar');
      const notifLink = mount.querySelector('[data-account-nav-notifications]');
      const notifCount = notifLink?.querySelector('.acct-menu-count');
      const n = Number(unread) || 0;
      const label = n > 9 ? '9+' : String(n);
      if (notifLink && notifCount) {
        notifLink.classList.toggle('has-unread', n > 0);
        notifLink.setAttribute('aria-label', n > 0 ? `Notifications, ${n} unread` : 'Notifications');
        notifCount.textContent = label;
        notifCount.hidden = n <= 0;
      }
      if (av && n > 0) {
        const dot = document.createElement('span');
        dot.className = 'acct-notif-dot';
        dot.textContent = label;
        av.appendChild(dot);
      }
    }).catch(() => {});
  }

  const out = mount.querySelector('.acct-signout');
  if (out) out.addEventListener('click', async () => { try { await logout(); } catch {} location.href = `${root}account.html`; });

  // Close the dropdown on outside click / Escape.
  const dd = mount.querySelector('details.acct-dd');
  if (dd) {
    // Document/window listeners are bound ONCE and look up the live dropdown, so
    // auth-change re-renders don't accumulate handlers on detached nodes.
    if (!document.documentElement.dataset.acctDdBound) {
      document.documentElement.dataset.acctDdBound = '1';
      const liveDd = () => document.querySelector('.nav-account details.acct-dd');
      document.addEventListener('click', (e) => { const d = liveDd(); if (d?.open && !d.closest('.nav-account').contains(e.target)) d.open = false; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const d = liveDd(); if (d) d.open = false; } });
    }
  }
}

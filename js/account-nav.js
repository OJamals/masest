/* MASEST - account control injected into the site nav (.nav-actions).
 * Logged out: a "Sign in" button. Signed in: an account dropdown (Dashboard, Orders,
 * Messages, Notifications, Settings, Admin if staff, Sign out). Loaded by main.js after
 * the nav is built: import('js/account-nav.js').then(m => m.initAccountNav({ nav, root })). */
import { esc } from './util.js';
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Account';

// Cheap logged-in check: Supabase persists its session under sb-<ref>-auth-token in localStorage.
// Lets anonymous visitors skip loading the Supabase SDK entirely (lighter marketing pages).
function hasSession() {
  try { return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('-auth-token')); }
  catch { return false; }
}

const MENU = [
  ['ph-squares-four', 'Dashboard', 'dashboard.html'],
  ['ph-briefcase', 'Business', 'business.html'],
  ['ph-package', 'Orders', 'dashboard.html#orders'],
  ['ph-chat-circle', 'Messages', 'dashboard.html#messages'],
  ['ph-bell', 'Notifications', 'dashboard.html#notifications'],
];

const ACCOUNT_MENU = [
  ['ph-user', 'Profile', 'dashboard.html#profile'],
  ['ph-fingerprint', 'Security', 'dashboard.html#security'],
  ['ph-map-pin', 'Addresses', 'dashboard.html#addresses'],
  ['ph-credit-card', 'Payment methods', 'dashboard.html#payment'],
];

function injectStyle() {
  if (document.getElementById('acct-nav-style')) return;
  const s = document.createElement('style');
  s.id = 'acct-nav-style';
  s.textContent = `
  .nav-account { display:flex; align-items:center; align-self:stretch; padding:0; }
  .nav-signin { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:var(--r-pill,999px);
    justify-content:center; align-self:center; min-height:42px; line-height:1; border:1.5px solid var(--line,#e4e6e9); font-weight:700; font-size:.9rem; color:var(--ink,#15171c); text-decoration:none; white-space:nowrap; }
  .nav-signin:hover { border-color:var(--ink,#15171c); }
  .nav.over-dark .nav-signin { color:#fff; border-color:rgba(255,255,255,.35); }
  .acct-dd { position:relative; }
  .acct-dd > summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px; padding:6px 10px 6px 6px;
    border-radius:var(--r-pill,999px); border:1.5px solid var(--line,#e4e6e9); font-weight:700; font-size:.88rem; color:var(--ink,#15171c); }
  .acct-dd > summary::-webkit-details-marker { display:none; }
  .acct-dd > summary:hover { border-color:var(--ink,#15171c); }
  .nav.over-dark .acct-dd > summary { color:#fff; border-color:rgba(255,255,255,.35); }
  .acct-avatar { position:relative; width:26px; height:26px; border-radius:50%; background:var(--accent,#0e7c86); color:#fff; display:grid; place-items:center; font-size:.8rem; font-weight:800; }
  .acct-notif-dot { position:absolute; top:-4px; right:-4px; min-width:15px; height:15px; padding:0 3px; border-radius:999px; background:#b42318; color:#fff; font-size:.58rem; font-weight:800; display:grid; place-items:center; line-height:1; box-shadow:0 0 0 2px var(--surface,#fff); }
  .nav.over-dark .acct-notif-dot { box-shadow:0 0 0 2px #0b0d12; }
  .acct-name { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .acct-dd-menu { position:fixed; left:8px; top:56px; width:min(236px, calc(100vw - 16px)); max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto; background:var(--surface,#fff);
    border:1px solid var(--line,#e4e6e9); border-radius:var(--r-card,16px); box-shadow:0 18px 40px -16px rgba(0,0,0,.28); padding:8px; z-index:120; }
  .acct-menu-section { padding:4px 0; }
  .acct-menu-section + .acct-menu-section { border-top:1px solid var(--line,#e4e6e9); margin-top:4px; padding-top:8px; }
  .acct-menu-label { display:block; padding:3px 10px 6px; color:var(--ink-soft,#393d44); font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
  .acct-dd-menu a, .acct-dd-menu button { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:10px 12px;
    border:0; background:none; border-radius:10px; font:inherit; font-size:.9rem; font-weight:600; color:var(--ink,#15171c); text-decoration:none; cursor:pointer; }
  .acct-dd-menu a:hover, .acct-dd-menu button:hover { background:var(--accent-tint,#f1f8f8); color:var(--accent-ink,#0a5b62); }
  .acct-dd-menu i { font-size:1.15rem; color:var(--ink-soft,#393d44); }
  .acct-dd-menu a.has-unread { font-weight:800; }
  .acct-menu-count { margin-left:auto; min-width:20px; height:20px; padding:0 6px; border-radius:999px; background:#b42318; color:#fff; font-size:.7rem; font-weight:800; display:inline-grid; place-items:center; line-height:1; }
  .acct-menu-count[hidden] { display:none; }
  .acct-dd-menu .acct-signout { border-top:1px solid var(--line,#e4e6e9); margin-top:6px; padding-top:12px; color:#b42318; }
  .acct-dd-menu .acct-admin { color:var(--accent-ink,#0a5b62); }
  /* Cart: transparent shopping-cart icon with a count bubble (replaces the "Cart" text pill) */
  .nav-cart { position:relative; display:inline-grid; place-items:center; width:42px; height:42px; border-radius:50%; background:transparent; color:var(--ink,#15171c); padding:0; }
  .nav-cart:hover { background:rgba(0,0,0,.06); }
  .nav.over-dark .nav-cart { color:#fff; }
  .nav.over-dark .nav-cart:hover { background:rgba(255,255,255,.12); }
  .nav-cart i { font-size:1.45rem; line-height:1; }
  .nav-cart .cart-count { position:absolute; top:1px; right:1px; min-width:17px; height:17px; padding:0 4px; border-radius:999px;
    background:var(--accent,#0e7c86); color:#fff; font-size:.64rem; font-weight:800; display:grid; place-items:center; line-height:1; box-shadow:0 0 0 2px var(--surface,#fff); }
  .nav.over-dark .nav-cart .cart-count { box-shadow:0 0 0 2px #0b0d12; }
  .nav-cart .cart-count[hidden] { display:none; }
  @media (max-width:860px){ .acct-name{ display:none; } }`;
  document.head.appendChild(s);
}

function positionAccountMenu(dd) {
  if (!dd?.open) return;
  const menu = dd.querySelector('.acct-dd-menu');
  const summary = dd.querySelector('summary');
  if (!menu || !summary) return;
  const rect = summary.getBoundingClientRect();
  const menuWidth = Math.min(menu.offsetWidth || 236, window.innerWidth - 16);
  const menuHeight = Math.min(menu.offsetHeight || 0, window.innerHeight - 16);
  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - menuHeight - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export async function initAccountNav({ nav, root = '' } = {}) {
  const actions = (nav || document).querySelector('.nav-actions');
  if (!actions) return;
  injectStyle();
  await renderAccountNav(actions, root);
  // Re-render when auth state changes in-page (login / logout / finish setup) so the
  // header swaps "Sign in" for the account dropdown without a full page reload.
  if (!actions.dataset.authBound) {
    actions.dataset.authBound = '1';
    document.addEventListener('masest:auth', () => { renderAccountNav(actions, root).catch(() => {}); });
  }
}

async function renderAccountNav(actions, root = '') {
  // Replace whatever account control is present: the SSR placeholder (.nav-auth-placeholder,
  // rendered by chrome.js) on first render, or a previously-rendered control (.nav-account)
  // on a later auth-change re-render. Matching only one of these would leave the other behind,
  // showing both a "Sign in" button and the account control at once.
  const prev = actions.querySelector('.nav-account, .nav-auth-placeholder');

  // Only load the Supabase SDK + call me() when a session exists; otherwise render Sign in instantly.
  let logout, api, data = null;
  if (hasSession()) {
    try { const m = await import('./auth.js'); logout = m.logout; api = m.api; data = await m.me(); } catch { data = null; }
  }

  const mount = document.createElement('div');
  mount.className = 'nav-account';

  if (!data) {
    mount.innerHTML = `<a class="nav-signin" href="${root}account.html"><i class="ph ph-sign-in" aria-hidden="true"></i> Sign in</a>`;
  } else if (data.needs_profile) {
    mount.innerHTML = `<a class="nav-signin" href="${root}account.html">Finish setup</a>`;
  } else {
    const label = data.profile?.full_name || data.company?.name || data.email || 'Account';
    const items = MENU.map(([i, l, h]) => {
      const isNotifications = l === 'Notifications';
      const marker = isNotifications ? ' data-account-nav-notifications' : '';
      const count = isNotifications ? '<span class="acct-menu-count" hidden>0</span>' : '';
      return `<a href="${root}${h}"${marker}><i class="ph ${i}" aria-hidden="true"></i>${esc(l)}${count}</a>`;
    }).join('');
    const accountItems = ACCOUNT_MENU.map(([i, l, h]) => `<a href="${root}${h}"><i class="ph ${i}" aria-hidden="true"></i>${esc(l)}</a>`).join('');
    const admin = data.is_staff ? `<a class="acct-admin" href="${root}admin.html"><i class="ph ph-shield-check" aria-hidden="true"></i>Admin console</a>` : '';
    mount.innerHTML = `<details class="acct-dd">
      <summary aria-haspopup="true"><span class="acct-avatar">${esc((label[0] || 'A').toUpperCase())}</span><span class="acct-name">${esc(firstName(label))}</span><i class="ph ph-caret-down" aria-hidden="true"></i></summary>
      <div class="acct-dd-menu" role="menu">
        <div class="acct-menu-section"><span class="acct-menu-label">Workspace</span>${items}</div>
        <div class="acct-menu-section"><span class="acct-menu-label">Account</span>${accountItems}</div>
        <div class="acct-menu-section">${admin}<button type="button" class="acct-signout"><i class="ph ph-sign-out" aria-hidden="true"></i>Sign out</button></div>
      </div>
    </details>`;
  }

  const burger = actions.querySelector('.nav-burger');
  if (prev) prev.replaceWith(mount);
  else actions.insertBefore(mount, burger || null);

  // Unread notification badge on the avatar (non-blocking; signed-in full accounts only).
  if (api && data && !data.needs_profile) {
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
    const syncMenuPosition = () => { if (dd.open) requestAnimationFrame(() => positionAccountMenu(dd)); };
    dd.addEventListener('toggle', syncMenuPosition);
    window.addEventListener('resize', syncMenuPosition);
    window.addEventListener('scroll', syncMenuPosition, { passive: true, capture: true });
    document.addEventListener('click', (e) => { if (dd.open && !mount.contains(e.target)) dd.open = false; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dd.open = false; });
  }
}

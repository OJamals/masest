import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin keeps a labeled customer-support launcher visible when unread count is empty', () => {
  const html = read('admin.html');
  const sharedSupport = read('js/admin-support.js');

  assert.match(html, /id="adminSupportLauncher"[^>]*aria-label="Open customer support"/);
  assert.match(html, /ph-lifebuoy/);
  assert.match(html, /class="admin-support-launcher__label">Customer support<\/span>/);
  assert.match(html, /id="adminSupportUnread" class="admin-support-unread" hidden>0<\/span>/);
  assert.match(html, /\.admin-support-unread\[hidden\] \{ display: none; \}/);
  assert.match(sharedSupport, /document\.getElementById\("adminSupportLauncher"\)/);
});

test('admin renders its own staff chrome, not the storefront nav', () => {
  const admin = read('js/admin.js');

  assert.match(admin, /import \{ renderAdminChrome, setAdminChromeUser \} from '\.\/admin\/chrome\.js\?v=\d{8}[a-z]'/);
  assert.match(admin, /renderAdminChrome\(\{ onSignOut: \(\) => \{ void logout\(\); \} \}\);/);
  // The storefront chrome stays on the public site: importing it here would put
  // the marketing nav, cart, and ~861px footer back on the operations console.
  assert.doesNotMatch(admin, /from '\.\/main\/chrome\.js/);
});

test('staff chrome omits storefront nav links, cart, lead bar, and marketing footer', () => {
  const chrome = read('js/admin/chrome.js');

  assert.match(chrome, /export function renderAdminChrome/);
  assert.match(chrome, /class="skip-link"|classList\.add\('skip-link'\)/);
  // Named, sized logo (admin is excluded from the shared logo-rendering sweep).
  assert.match(chrome, /class="nav-logo" href="\/" aria-label="MASEST home"/);
  assert.match(chrome, /src="\/img\/masest-logo-ink\.png" alt="MASEST" width="\d+" height="\d+"/);
  // Staff keep identity + sign out, rendered natively rather than by mounting the
  // buyer account nav (see admin-message-center's buyer-UI boundary).
  assert.match(chrome, /admChromeUser/);
  assert.match(chrome, /id="admSignOut"/);
  assert.match(chrome, /export function setAdminChromeUser/);

  for (const [label, pattern] of [
    ['cart', /nav-cart|data-cart-count/],
    ['burger menu', /nav-burger/],
    ['primary storefront links', /nav-links|"Programs"|"Use Cases"/],
    ['lead action bar', /lead-action-bar/],
    ['marketing footer', /createElement\("footer"\)|createElement\('footer'\)|foot-grid/],
    ['buyer account nav', /account-nav|nav-auth-placeholder/],
  ]) {
    assert.doesNotMatch(chrome, pattern, `staff chrome should not render the ${label}`);
  }
});

test('admin releases the tab-swap height reservation instead of ratcheting it', () => {
  const admin = read('js/admin.js');

  // reserveAdminHeight used to only ever grow min-height, so a short tab kept the
  // tallest tab's scroll height for the rest of the session.
  assert.match(admin, /function releaseAdminHeight\(/);
  assert.doesNotMatch(admin, /if \(visibleHeight > current\) main\.style\.minHeight/);
  assert.match(admin, /main\.style\.minHeight = '';/);
  assert.match(admin, /releaseAdminHeight\(settledTab, token\)/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('one customer-support console serves admin and public surfaces', () => {
  const html = read('admin.html');
  const support = read('js/admin-support.js');
  const threads = read('js/admin/threads.js');
  const customerChat = read('js/customer-chat.js');

  // admin.html used to ship its own static drawer + launcher, so staff saw one
  // support UI on /admin and a different-looking one on every other page.
  for (const stale of ['adminSupportDrawer', 'adminSupportLauncher', 'admThreads', 'admThreadView']) {
    assert.doesNotMatch(html, new RegExp(stale), `${stale} should no longer be static markup`);
  }
  // The one console injects its own launcher, labelled the same everywhere.
  assert.match(support, /class="site-support__launcher"[^>]*aria-label="Open customer support"/);
  assert.match(support, /ph-lifebuoy/);
  assert.match(support, /<span>Customer support<\/span>/);
  // Mounted from both entry points, and guarded so a document can only get one.
  assert.match(threads, /import\('\.\.\/admin-support\.js\?v=\d{8}[a-z]'\)/);
  assert.match(customerChat, /import\("\.\/admin-support\.js\?v=\d{8}[a-z]"\)/);
  assert.match(support, /if \(document\.getElementById\("adminSupportConsole"\) \|\| !auth\?\.api\) return null;/);
  // Buyers still get the chat widget; only staff swap to the console.
  assert.match(customerChat, /account\?\.can_admin/);
});

test('support console puts close top-right and settings top-left', () => {
  const support = read('js/admin-support.js');
  const css = read('css/admin-support.css');

  // List-pane header owns settings; the conversation toolbar owns close.
  const listHeader = support.match(/<div class="site-support__header-actions">[\s\S]*?<\/div>/)[0];
  assert.match(listHeader, /aria-label="Customer support settings"/);
  assert.doesNotMatch(listHeader, /Close support menu/, 'close should not sit in the list header');

  const toolbar = support.match(/<header class="site-support__conversation-toolbar">[\s\S]*?<\/header>/)[0];
  assert.match(toolbar, /aria-label="Close support menu"/);
  assert.doesNotMatch(toolbar, /Customer support settings/, 'the duplicate gear should be gone');

  // The gear was previously hidden here and duplicated in the toolbar.
  assert.doesNotMatch(css, /\.site-support__header-actions > a \{ display: none; \}/);
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

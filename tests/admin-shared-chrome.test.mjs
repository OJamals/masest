import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin keeps a labeled customer-support launcher visible when unread count is empty', () => {
  const html = read('admin.html');
  const admin = read('js/admin.js');
  const sharedSupport = read('js/admin-support.js');

  assert.match(admin, /import \{ renderChrome \} from '\.\/main\/chrome\.js\?v=/);
  assert.match(admin, /renderChrome\(\);/);
  assert.match(html, /id="adminSupportLauncher"[^>]*aria-label="Open customer support"/);
  assert.match(html, /ph-lifebuoy/);
  assert.match(html, /class="admin-support-launcher__label">Customer support<\/span>/);
  assert.match(html, /id="adminSupportUnread" class="admin-support-unread" hidden>0<\/span>/);
  assert.match(html, /\.admin-support-unread\[hidden\] \{ display: none; \}/);
  assert.match(sharedSupport, /document\.getElementById\("adminSupportLauncher"\)/);
});

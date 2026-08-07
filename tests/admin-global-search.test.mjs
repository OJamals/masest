import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const endpoint = read('functions/api/admin/search.js');
const ui = read('js/admin/search.js');
const admin = read('js/admin.js');
const html = read('admin.html');

test('cross-entity search endpoint is staff-gated and injection-safe', () => {
  assert.match(endpoint, /if \(!user\) return json\(401, \{ error: 'unauthenticated' \}\)/);
  assert.match(endpoint, /if \(!staff\) return json\(403, \{ error: 'forbidden' \}\)/);
  // Wildcards in the term must not leak into the ilike pattern.
  assert.match(endpoint, /import \{ escapeLike \}/);
  assert.match(endpoint, /const like = `%\$\{escapeLike\(q\)\}%`/);
  assert.doesNotMatch(endpoint, /ilike[^\n]*\$\{q\}/, 'the raw term must never be interpolated into a filter');
});

test('search covers every entity staff look up, with a bounded result set', () => {
  for (const table of ['orders', 'quotes', 'companies', 'crm_contacts', 'products']) {
    assert.match(endpoint, new RegExp(`from\\('${table}'\\)`), `search should cover ${table}`);
  }
  assert.match(endpoint, /const MIN_QUERY = 2/);
  assert.match(endpoint, /if \(q\.length < MIN_QUERY\) return json\(200, \{ q, groups: \[\], total: 0 \}\)/);
  assert.match(endpoint, /Math\.min\(MAX_LIMIT/, 'callers must not be able to request an unbounded page');
  // One failing group (e.g. a table missing pre-migration) must not 500 the box.
  assert.match(endpoint, /async function group\([\s\S]{0,200}catch \{\s*return null;/);
});

test('search results carry their own routing target', () => {
  // Every item tells the client which workspace owns it, so routing is not a
  // client-side switch that drifts from the API.
  assert.match(endpoint, /tab: 'orders'[\s\S]{0,160}search:/);
  assert.match(endpoint, /tab: 'quotes'[\s\S]{0,40}open: row\.id/);
  assert.match(endpoint, /tab: 'companies'[\s\S]{0,40}open: row\.id/);
  assert.match(endpoint, /tab: 'crm'[\s\S]{0,40}open: row\.id/);
});

test('search box implements the combobox pattern with keyboard control', () => {
  assert.match(ui, /role="combobox"/);
  assert.match(ui, /role="listbox"/);
  assert.match(ui, /role="option"/);
  assert.match(ui, /aria-autocomplete="list"/);
  // Arrow keys move an aria-activedescendant, so focus never leaves the input.
  assert.match(ui, /aria-activedescendant/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.match(ui, new RegExp(`'${key}'`), `search should handle ${key}`);
  }
  assert.match(ui, /event\.metaKey \|\| event\.ctrlKey[\s\S]{0,60}'k'/, 'Cmd/Ctrl+K should focus search');
  assert.match(ui, /event\.key === '\/' && !typing/, '"/" should focus search outside text fields');
});

test('search escapes untrusted record text and drops stale responses', () => {
  assert.match(ui, /esc\(item\.title\)/);
  assert.match(ui, /esc\(item\.subtitle\)/);
  assert.match(ui, /esc\(group\.label\)/);
  // A slow response for an earlier keystroke must not overwrite a newer render.
  assert.match(ui, /const token = \+\+seq/);
  assert.match(ui, /if \(token !== seq\) return/);
  assert.match(ui, /debounce/);
});

test('admin mounts search behind the staff gate and routes results', () => {
  assert.match(admin, /import \{ createAdminSearch \} from '\.\/admin\/search\.js\?v=\d{8}[a-z]'/);
  // Mounted only after /api/admin/stats confirms staff access.
  assert.match(admin, /\$\('admApp'\)\.hidden = false;\s*\n\s*mountGlobalSearch\(\);/);
  assert.match(admin, /function routeSearchResult\(item\)/);
  assert.match(admin, /context\.openQuoteId = item\.open/);
  assert.match(admin, /context\.openCompanyId = item\.open/);
  assert.match(admin, /context\.openContactId = item\.open/);
  // Queue-backed tabs land with the record filtered into view.
  assert.match(admin, /\{ orders: 'ordSearch', products: 'prodSearch' \}\[item\.tab\]/);
  assert.match(admin, /dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test('staff chrome reserves a search slot and styles the results panel', () => {
  assert.match(read('js/admin/chrome.js'), /class="adm-chrome-search"/);
  assert.match(html, /\.adm-search-results \{[^}]*position: absolute/);
  assert.match(html, /\.adm-search-option\[aria-selected="true"\]/);
});

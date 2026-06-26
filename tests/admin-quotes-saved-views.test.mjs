import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/quotes.js', import.meta.url), 'utf8');

test('quotes tab imports + constructs saved views for its own key', () => {
  assert.match(src, /import \{ createSavedViews \} from '\.\/saved-views\.js'/);
  assert.match(src, /createSavedViews\(\{\s*key: 'quotes'/);
});

test('getFilters captures every quotes filter input + view mode', () => {
  for (const id of ['qSearch', 'qFilter', 'qPriority', 'qOwner', 'qDue']) {
    assert.match(src, new RegExp(`\\$\\('${id}'\\)`));
  }
  assert.match(src, /view: state\.quotesView \|\| 'list'/);
});

test('applyFilters writes inputs back + re-renders without refetch', () => {
  assert.match(src, /\$\('qSearch'\)\.value = f\.search/);
  assert.match(src, /reflectToggle\(\);/);
  assert.match(src, /renderQuotePipeline\(\{ refetch: false \}\)/);
});

test('saved-views control mounts in the render path', () => {
  assert.match(src, /ensureSavedViews\(\)/);
  assert.match(src, /savedViews\.mount\(box\)/);
});

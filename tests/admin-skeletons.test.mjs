// Admin loading skeletons + rich empty states (#31 batch 2).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// admSkeleton/admEmpty are defined in admin.js; their *usages* now live across the
// per-tab modules (#36 split), so the count tests scan the whole admin surface.
const src = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminDir = new URL('../js/admin/', import.meta.url);
const srcAll = src + readdirSync(adminDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(f, adminDir), 'utf8'))
  .join('\n');

test('admin defines reusable skeleton + empty-state helpers', () => {
  assert.match(src, /admSkeleton/, 'skeleton helper');
  assert.match(src, /admEmpty/, 'empty-state helper');
  assert.match(src, /skeleton skeleton-block/, 'reuses the shared skeleton block');
  assert.match(src, /class="empty-state"/, 'reuses the shared empty-state block');
});

test('main admin lists show skeletons while loading instead of "Loading..." text', () => {
  const skeletonCalls = (srcAll.match(/admSkeleton\(/g) || []).length;
  assert.ok(skeletonCalls >= 5, `expected >=5 skeleton loaders, got ${skeletonCalls}`);
});

test('main admin lists use styled empty states', () => {
  const emptyCalls = (srcAll.match(/admEmpty\(/g) || []).length;
  assert.ok(emptyCalls >= 5, `expected >=5 styled empty states, got ${emptyCalls}`);
});

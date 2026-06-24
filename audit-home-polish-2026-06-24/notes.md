# Homepage Scrollybook Polish QA - 2026-06-24

## Scope

- Reviewed the homepage scrollybook across desktop, laptop-height, tablet, and mobile viewports.
- Checked representative site pages for horizontal overflow, clipping, overlapping text/images, font mismatches, color inconsistencies, and hierarchy issues.
- Saved screenshots and DOM geometry metrics in this folder for traceable before/after evidence.

## Findings And Fixes

- Act 2 pipe scene was too large on short laptop viewports, causing visual pressure against the copy and clipping risk. Reduced the base diagram width and added short-viewport positioning rules.
- Act 4 cost scene on mobile reserved layout space for hidden animation rows, which made the comparison feel clipped and left a blank-looking legacy card during part of the scroll. Converted mobile to a compact, immediately readable comparison layout with stable two-line rows and tighter spacing.
- Story scrub felt slightly abrupt. Increased scrub smoothing and hold timing so scene transitions breathe without feeling sluggish.
- HMIS SVG score numerals used a different fallback typeface than the rest of the story. Aligned them to the site body font stack.
- Site-wide geometry checks reported intentional offscreen carousel slides and skip links, but no page-level horizontal overflow or real clipping on the reviewed pages.

## Verification

- `npm run check`
- `node tools/verify_site.mjs`
- `node --test --test-concurrency=1 --test-timeout=120000 tests/ui-structure.test.mjs tests/product-media-flow.test.mjs tests/product-layout.test.mjs tests/seo-meta.test.mjs`
- `npx playwright test tools/story-hmis-visual.spec.mjs --reporter=line`
- `npm run verify`

All listed verification commands passed.

## Second-Pass Verification

- Rechecked the story at Act 2 laptop height and Act 4 mobile entry/mid/settled scroll positions. No visible story clipping, horizontal overflow, or cramped text remained.
- Rechecked product detail pages around the Replacement Target section on mobile and desktop. The lower detail sections use normal line-height and spacing, and the transparent MASEST poster is no longer top-clipped.
- Rechecked the product catalog. Product media cards now render on white media surfaces with contained product imagery; the earlier light-blue gradient mismatch is gone.
- Found one remaining mobile catalog issue: the persistent lead-action bar could cover card quote controls while the product grid was in view. Fixed it by suppressing the lead-action bar only while `#shopGrid` intersects the viewport, preserving the persistent bar on the rest of the page.
- Found one mobile header touch-target regression during Playwright verification: the dynamic account-nav Sign in pill computed to 42px high. Updated the injected account-nav style to 44px.

Additional commands run after the second-pass fixes:

- `node --test --test-concurrency=1 --test-timeout=120000 tests/lead-action-bar.test.mjs tests/ui-structure.test.mjs tests/product-media-flow.test.mjs tests/product-layout.test.mjs tests/seo-meta.test.mjs`
- `npx playwright test tools/site-audit-regressions.spec.mjs tools/story-hmis-visual.spec.mjs --reporter=line`
- `npm run verify`

All second-pass verification commands passed.

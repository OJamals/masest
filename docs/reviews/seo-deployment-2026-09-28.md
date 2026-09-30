# MASEST SEO measurement deployment — September 28, 2026

Status: deployed and verified on `https://masest.co`. Cloudflare completed deployment September 29 at 01:44:22 UTC (September 28, 9:44 PM EDT). Live checks completed at 01:46 UTC, followed by a browser check of the existing contact form.

- Authorized scope: deploy the SEO audit's implemented analytics corrections and refresh browser asset references. The earlier URL-recovery and return-policy repairs were already live.
- Commit: `7b0b7b8aa8afdba65a02359da861775604564414`.
- Previous production commit / rollback source: `4ec2207bcd0318cac3a8d9ac2ca36259709c5499`.
- [Production verification and deployment](https://github.com/OJamals/masest/actions/runs/36508217247), triggered September 29 at 01:30:20 UTC (September 28 in Florida).
- Cloudflare deployment: [`f82eb185`](https://f82eb185.masest-commerce.pages.dev), project `masest-commerce`, production branch `main`.
- No database migration or provider/DNS configuration change.

## Scope reviewed

The release fixes pageview/session counts, paginates traffic beyond Supabase's 1,000-row response limit, preserves entry referrer attribution without copying URL secrets, deduplicates quote acknowledgement events, and excludes unpaid/test checkout confirmations from paid-confirmation metrics. Admin reporting distinguishes browser signals, partial windows, and unavailable data.

Browser JavaScript was served with a four-hour cache lifetime. The release updates its shared references to `20260928a`, including the tracker and generated page templates, so existing browsers request the new code. The blog stylesheet's version reference follows its shared blog release constant; stylesheet content is unchanged.

Of 181 committed files, 167 were verified to contain only asset-reference/release-token changes after normalization. The remaining 14 contain the reviewed logic and test changes. No unexpected content changes or credential patterns were found in staged additions. Audit documents, local graph files, supplier PDFs, images, and data snapshots were excluded from the commit. Generated sitemap changes remain local; the established build regenerates the deployed sitemap.

**The landing-page redesign, private-label/HVAC page drafts, simplified call/email forms, Matthew email-routing changes, and rebranded supplier documents remain on hold.** Existing page content and form layout are preserved in this release.

## Local verification

- 3,098 unit tests passed, plus 3 database/provider-retirement tests and the support-ticket database verification.
- Workspace/browser regression suite: 91 passed. Commerce smoke suite: 36 passed.
- After the cache refresh, 36 focused auth/cache/tracking tests passed. Updated tests retain exact release-version assertions.
- Rebuilt the final assets and passed site verification: 130 HTML, 7 CSS, 287 JavaScript files.
- Final interaction suite: 83 passed. An earlier attempt observed mixed old/new asset versions while the cache update was being applied; the final stable build passed the complete suite.
- Homepage performance: 4 passed. Controlled scrolling performance: 1 passed, all three samples within budget.
- Staged diff and scope checks passed. A local Cloudflare Pages Functions compilation had already passed during the audit.

## Production and live verification

The production workflow completed successfully for `7b0b7b8aa8afdba65a02359da861775604564414`. Remote `main` matches that commit. Cloudflare's deployment step used the workflow SHA, `--branch=main`, and `--commit-dirty=false`.

- CI passed 3,098 unit tests, 3 database/provider-retirement tests, 91 workspace/browser regressions, 36 commerce smoke tests, 83 interaction tests, and 4 homepage performance tests.
- All **101 sitemap URLs** returned HTTP 200, one matching self-canonical, one nonempty title, one nonempty description, and no HTML/header `noindex`. All observed tracker references use `20260928a`. These are live technical checks, not proof that Google has indexed every URL.
- All **15 sitemap product pages / 30 offers** retain return-policy markup: US, 30 days, mail return, customer-paid return shipping, and the shipping/returns policy URL.
- `/product?id=hcr` returns 301 to `/products/hcr`; `/products/contact` returns 301 to `/contact`.
- Live `track.js`, `main/engagement.js`, `admin.js`, and `admin/traffic.js`, requested with `?v=20260928a`, match the local release build byte-for-byte by SHA-256.
- `/order-confirmed` serves the explicit `payment_status === "paid" && live_mode === true` tracking guard. `/api/order` without a session returns 400. Unauthenticated admin stats/traffic requests return 401.
- Homepage main-content SHA-256 remains `70b21c081f70a4a3ce11baaae95c948a74172bb64de43af6c9841642b1916a5d`, matching the pre-release page. Browser inspection confirmed the existing contact form still renders with name, company, email, request details, and its existing submit action. The held callback/email redesign was not published.

No live lead, payment, email, or newsletter was submitted. Authenticated admin totals were not re-exercised through the live UI; their computation is covered by the tests and the earlier fixed-snapshot production read. Browser page loads used for verification can add ordinary pageview events.

## Rollback

If this release causes a regression, revert `7b0b7b8a` and run the same verified production workflow. The preceding deployed source is `4ec2207b`. There is no schema rollback. Do not reset or publish the separate held UI worktree as part of rollback.

Business measurement remains bounded: browser beacons can be missing, repeated across sessions, or forged. Durable Quotes and Orders remain authoritative for lead and payment totals. This deployment does not backfill missing historical attribution or turn existing traffic into verified customer counts. The content and acquisition priorities remain in the [September 28 follow-up](search-console-follow-up-2026-09-28.md).

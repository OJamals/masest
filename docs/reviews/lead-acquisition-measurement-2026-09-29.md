# Website lead acquisition measurement

## Questions this change answers

1. Which recorded session entry pages and sources produce durable website requests?
2. How many requests ask for a call or an email reply?
3. What are those requests' current qualification, proposal, and won stages?
4. How many requests were excluded as spam, known staff email, or explicitly marked internal/test?

## Contract

- The browser's session entry context is optional, self-reported attribution. It never authorizes access or proves identity.
- Persist only a public marketing path, external referrer origin, and three bounded campaign labels. Strip query strings, fragments, credentials, and unsupported fields. Do not link visitor IDs to leads.
- Both request modes retain attribution without adding customer form fields. Attribution failure must never prevent submission. Existing idempotency and durable acknowledgement remain the acceptance boundary.
- Aggregate saved `quotes` with `source=contact`, using a fixed creation-time window and bounded pagination. Browser events are not lead counts.
- Unknown historical attribution remains unknown. Pipeline figures describe current state, not a historical conversion funnel or proof that a quote was delivered.
- Exclude spam, exact configured staff-email matches, and `reporting_excluded=true`. Only the staff quote mutation can set that database flag; the public form cannot.
- Keep the existing traffic report and sales workflow. Add a 28-day website request report and source details to staff views.

## Deployment and verification

Apply `supabase/schema-lead-acquisition.sql` before deploying the application. This additive migration does not change quote access policies or existing request values. Reverting the application can leave the unused column in place.

Verify sanitizer behavior, first-entry retention, both form modes, retry identity, authoritative exclusions, pagination and partial-window disclosure, unavailable-data handling, staff authorization, and escaped report rendering. Run the normal release gates, then inspect the live report without sending customer messages.

Staff can mark a test/internal request in its Quotes drawer using **Exclude from acquisition reporting**, then save. The request stays available for operational follow-up. Keep campaign labels free of personal identifiers.

## Release validation

- `TMPDIR=/tmp npm run verify:core` passed: 3,099 tests, database harnesses, build/static validation, and the workspace, commerce, and interaction browser suites.
- `npm run qa:ui-critical:performance` passed all four checks.
- Browser tests cover search entry to both contact modes, a lost acknowledgement after durable save, and retries after campaign context changes. Legacy retries retain their exact pre-release fingerprint fallback.
- Independent review found no remaining blockers after fixing late-session campaign capture and metadata-dependent retry identity. Older open sessions retain unknown entry context rather than inventing it.
- The additive migration was applied on 2026-09-30 UTC through Supabase's authenticated HTTPS Management API. Production configuration matched the migration target. The two existing quote rows, access-control grants, RLS setting, and policies were unchanged. The new field is non-null boolean with default `false`; REST schema visibility was verified.
- Browser assets use release `20260929d`. The generated sitemap retains the same 102 URLs, with the build date refreshed.

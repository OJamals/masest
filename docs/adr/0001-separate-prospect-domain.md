# ADR 0001: Keep imported prospects separate from customer accounts

- Status: Accepted
- Date: 2026-09-02

## Context

The consolidated research roster contains 794 organizations and 582 named people.
These records have source provenance but no verified account ownership, portal identity,
or bulk-marketing consent. Existing `companies`, `profiles`, and `crm_contacts` describe
actual customer accounts and their account-owned contacts. Loading research records there
would make customer/support/order semantics ambiguous and could silently expand marketing
audiences.

## Decision

Use one isolated, staff-only Prospect domain:

- `prospect_import_batches` pins workbook and manifest hashes plus aggregate counts.
- `prospect_organizations` stores pre-account organization records.
- `prospect_contacts` stores named people under Prospect Organizations.
- `prospect_source_records` maps non-PII source IDs to imported records.

All imported consent is `unknown`; outreach is `unreviewed`. No import or API path writes
to Companies, Buyer accounts, account CRM contacts, support messages, Klaviyo, or newsletter
recipients. A Prospect Organization may become customer context only through an explicit
`linked_company_id`. The existing CRM workspace owns the Prospect UI so staff have one
relationship workspace without creating a second admin application.

## Consequences

- Customer/order/support behavior stays canonical and unaffected.
- Re-imports are idempotent by stable identity key and immutable source hash.
- Optional descriptive fields may improve on re-import; manually managed workflow,
  conversion, consent, and outreach state are never overwritten by the importer.
- Retention-review dates and an owner-only erase endpoint provide PII lifecycle controls.
- The additive schema can deploy before application code. Emergency rollback requires the
  explicit database-session confirmation in `supabase/rollback-crm-prospects.sql`.

# ShipStation API Free fulfillment

MASEST uses ShipStation API V2 directly. ShipStation Standard app subscription is not required for this integration. Current slice supports:

- redacted connection/readiness check;
- connected-carrier discovery;
- live multi-package rate shopping;
- staff-gated 4 × 6 PDF label purchase;
- atomic purchase claim plus persisted label/tracking state;
- order-scoped label void with explicit reason/confirmation and atomic pending-refund evidence;
- immutable postage purchase/void entries in admin order financial detail;
- CMS-owned default parcel profiles per variant;
- authenticated, idempotent carrier tracking webhooks;
- existing manual shipment-status/customer-email flow as override/recovery.

## Secrets and configuration

Never store the API key in `admin.html`, browser JavaScript, Supabase, Git, or a public Cloudflare variable.

Local development: add these unquoted values to the gitignored `.dev.vars` file:

```dotenv
SHIPSTATION_API_KEY=YOUR_V2_API_KEY
SHIPSTATION_WAREHOUSE_ID=se-YOUR_WAREHOUSE_ID
SHIPSTATION_WEBHOOK_TOKEN=GENERATE_A_RANDOM_32_BYTE_VALUE
```

Production and Preview: add `SHIPSTATION_API_KEY`, `SHIPSTATION_WAREHOUSE_ID`, and `SHIPSTATION_WEBHOOK_TOKEN` as encrypted Cloudflare Pages secrets for project `masest-commerce`. Dashboard path: **Workers & Pages → masest-commerce → Settings → Variables and Secrets**.

CLI equivalent for the secret:

```bash
npx wrangler pages secret put SHIPSTATION_API_KEY --project-name masest-commerce
```

Do not paste the key into shell history. The command prompts securely for its value.

## Database

Apply once through Supabase SQL Editor or the normal migration runner:

```text
supabase/schema-shipments.sql
supabase/schema-shipstation.sql
supabase/schema-shipstation-shipments.sql
supabase/schema-provider-inbox.sql
```

All migrations are re-runnable. Shipment migration supplies customer-visible status history. ShipStation migrations add provider IDs/status/cost fields, variant package profiles, normalized split shipments/packages/rates, provider-event idempotency, immutable `order_financial_entries`, state constraints, and service-role-only shipment/label/tracking/void RPCs. `order_shipments.status` is provider-shipment operation state; customer-visible fulfillment remains `orders.tracking_status` plus `shipment_events`.

Transactional verification and rollback:

```bash
node tools/verify-provider-financial-ledger.mjs --verify
tools/rollback-shipstation-financial-ledger.sh --verify
```

## Warehouse ID

After setting the API key, call the staff-only connection endpoint or open **Admin → Integrations → ShipStation API Free**:

```bash
curl -sS https://masest.co/api/admin/shipstation \
  -H "Authorization: Bearer STAFF_SUPABASE_ACCESS_TOKEN"
```

Copy desired `warehouses[].warehouse_id` into `SHIPSTATION_WAREHOUSE_ID`. Endpoint returns only redacted key presence, warehouse IDs/names, and connected carriers—never the key.

## Fulfillment workflow

1. Open **Admin → Orders & fulfillment**.
2. Expand order shipment controls, then **ShipStation API Free**.
3. Enter customer phone and address type.
4. Leave package override blank to use **Admin → Products → Variants** CMS values (`Ship lb`, `Length in`, `Width in`, `Height in`). One CMS parcel is created per ordered unit. Or enter one manual package per line: `weight_lb, length_in, width_in, height_in`. Dimensions are optional; weight is required. Example:

   ```text
   42.5, 14, 14, 18
   9
   ```

5. Select **Get live rates**. API quotes every carrier connected to this V2 key.
6. Select rate, then **Buy 4 × 6 PDF label**. Confirmation is required because ShipStation API Free has no sandbox and purchase charges the connected carrier account.
7. Open PDF label. Order moves to `packing`; label creation alone does not mark it shipped.
8. After deployment, open **Admin → Integrations → ShipStation API Free** and click **Configure tracking webhook**. It registers `track` at `/api/shipstation-webhook` with `X-MASEST-Webhook-Token`; the handler also verifies ShipEngine's RSA-SHA256 signature, timestamp, key ID, and official JWKS.
   ShipStation currently omits custom headers from webhook list responses; the admin status reports this as provider-masked rather than falsely claiming header verification.
9. Carrier updates enter the generic provider inbox before ACK. The worker writes immutable shipment history and advances `packing`, `shipped`, `blocked`, or `delivered` only when provider occurrence time is current. Existing manual tracking control remains available for recovery.
10. Webhook redeliveries and `GET /labels/{label_id}/track` reconciliation use the same canonical tracking normalizer. Identity is `canonical:v2:<sha256>` over fixed, sanitized mutation fields—not raw JSON—so whitespace/key order cannot duplicate work and a real tracking change cannot collide.
11. Before carrier movement, expand **Void label / request carrier refund**, enter a specific reason, check the explicit confirmation, then click **Void label**. One atomic claim permits one provider `PUT /v2/labels/{label_id}/void` call. In-transit/delivered labels are blocked.
12. Provider `approved: true` atomically records `label_voided`, one shipment-history event, and a pending negative postage entry. It means the carrier refund was requested—not settled. Rejected responses record `label_void_failed`; timeout/5xx records `void_reconcile_required`; neither creates refund evidence.
13. Open order detail to inspect provider IDs, realized postage, pending carrier credit, integration effects, shipment events, and staff audit history together.

## Duplicate-charge guard

Label purchase validates selected rate belongs to order's persisted ShipStation shipment, then atomically claims order before provider purchase. Existing labels return idempotently. Ambiguous provider/network results lock order as `reconcile_required`; staff must inspect ShipStation before any retry.

Label void uses a second atomic claim and transactional finalizer. A retry after confirmed void repairs/returns the same pending financial entry and shipment event without a second provider call. Confirmed void permits re-rating and replacement-label purchase; prior provider link and ledger identities remain immutable.

## Provider references

- [Authentication](https://docs.shipstation.com/authentication)
- [ShipStation API Free plan](https://docs.shipstation.com/plans/shipstation-api-free)
- [Rate shopping](https://docs.shipstation.com/rate-shopping)
- [Create labels](https://docs.shipstation.com/create-labels)
- [Void a label](https://docs.shipstation.com/openapi/labels/void_label)
- [Void-label refund behavior](https://docs.shipstation.com/void-labels)
- [Webhooks](https://docs.shipstation.com/apis/openapi/webhooks)

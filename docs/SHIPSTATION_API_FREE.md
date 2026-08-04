# ShipStation API Free fulfillment

MASEST uses ShipStation API V2 directly. ShipStation Standard app subscription is not required for this integration. Current slice supports:

- redacted connection/readiness check;
- connected-carrier discovery;
- live multi-package rate shopping;
- staff-gated 4 × 6 PDF label purchase;
- atomic purchase claim plus persisted label/tracking state;
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
supabase/schema-provider-inbox.sql
```

Both migrations are additive/re-runnable. Shipment migration supplies customer-visible status history. ShipStation migration adds provider IDs/status/cost fields, variant package profiles, provider-event idempotency, state constraints, and service-role-only label/tracking RPCs.

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

## Duplicate-charge guard

Label purchase validates selected rate belongs to order's persisted ShipStation shipment, then atomically claims order before provider purchase. Existing labels return idempotently. Ambiguous provider/network results lock order as `reconcile_required`; staff must inspect ShipStation before any retry.

## Provider references

- [Authentication](https://docs.shipstation.com/authentication)
- [ShipStation API Free plan](https://docs.shipstation.com/plans/shipstation-api-free)
- [Rate shopping](https://docs.shipstation.com/rate-shopping)
- [Create labels](https://docs.shipstation.com/create-labels)
- [Webhooks](https://docs.shipstation.com/apis/openapi/webhooks)

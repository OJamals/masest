#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BASE=${INTEGRATION_EFFECTS_ROLLBACK_BASE:-4aa7148e}
MODE=${1:---verify}

cd "$ROOT"
git cat-file -e "$BASE^{commit}"
for path in \
  .env.example \
  functions/_lib/stripe-effects.js \
  functions/api/admin/stripe-effects.js \
  functions/api/stripe-webhook.js \
  supabase/stripe-effects-cron.example.sql \
  supabase/schema-stripe-effects.sql \
  supabase/schema-integration-events.sql \
  tests/admin-authz.test.mjs \
  tests/checkout-stock.test.mjs \
  tests/email-chokepoint-coverage.test.mjs \
  tests/integration-events-schema.test.mjs \
  tests/money-flow-handlers.test.mjs \
  tests/order-shipment-email.test.mjs \
  tests/resend-idempotency-wiring.test.mjs \
  tests/stripe-effects.test.mjs \
  tests/stripe-webhook.test.mjs \
  tools/verify-integration-events-db.mjs
do
  git cat-file -e "$BASE:$path"
done

if [ "$MODE" = "--verify" ]; then
  printf '%s\n' "runtime rollback verified: $BASE"
  exit 0
fi
if [ "$MODE" = "--activate" ]; then
  # Old runtime must already be live. No-secret request proves route presence while
  # remaining side-effect free; 401 is its configured fail-closed response.
  STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST 'https://masest.co/api/admin/stripe-effects?limit=1')
  if [ "$STATUS" != "401" ]; then
    printf '%s\n' "legacy runtime not live: HTTP $STATUS" >&2
    exit 1
  fi
  # Generic runtime is now frozen. Reconstruct current rows and switch scheduler in
  # one transaction, including receipts written after original cutover.
  node tools/verify-integration-effects-cutover.mjs --rollback
  printf '%s\n' 'legacy DB + scheduler activated'
  exit 0
fi
if [ "$MODE" != "--prepare" ]; then
  printf '%s\n' "usage: $0 [--verify|--prepare|--activate]" >&2
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' 'rollback prepare requires a clean tracked worktree' >&2
  exit 1
fi

git restore --source="$BASE" -- \
  .env.example \
  functions/_lib/stripe-effects.js \
  functions/api/admin/stripe-effects.js \
  functions/api/stripe-webhook.js \
  supabase/stripe-effects-cron.example.sql \
  supabase/schema-stripe-effects.sql \
  supabase/schema-integration-events.sql \
  tests/admin-authz.test.mjs \
  tests/checkout-stock.test.mjs \
  tests/email-chokepoint-coverage.test.mjs \
  tests/integration-events-schema.test.mjs \
  tests/money-flow-handlers.test.mjs \
  tests/order-shipment-email.test.mjs \
  tests/resend-idempotency-wiring.test.mjs \
  tests/stripe-effects.test.mjs \
  tests/stripe-webhook.test.mjs \
  tools/verify-integration-events-db.mjs
rm -f \
  functions/_lib/integration-effects.js \
  functions/api/admin/integration-effects.js \
  supabase/integration-effects-cron.example.sql \
  tests/integration-effects.test.mjs

printf '%s\n' 'legacy runtime/tests/config prepared'
printf '%s\n' 'next: npm test; commit; deploy; then run --activate'

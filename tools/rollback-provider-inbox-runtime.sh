#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BASE=${PROVIDER_INBOX_ROLLBACK_BASE:-4657c78b}
MODE=${1:---verify}

cd "$ROOT"
git cat-file -e "$BASE^{commit}"
for path in \
  .env.example \
  CLOUDFLARE_PAGES.md \
  admin.html \
  docs/SHIPSTATION_API_FREE.md \
  functions/_lib/integration-effects.js \
  functions/_lib/shipstation.js \
  functions/api/admin/orders.js \
  functions/api/admin/qbo/status.js \
  functions/api/resend-webhook.js \
  functions/api/shipstation-webhook.js \
  js/admin.js \
  js/admin/orders.js \
  js/admin/qbo.js \
  js/admin/shipstation.js \
  tests/integration-effects.test.mjs \
  tests/admin-order-detail.test.mjs \
  tests/money-flow-handlers.test.mjs \
  tests/resend-webhook.test.mjs \
  tests/shipstation-webhook.test.mjs \
  tests/shipstation.test.mjs \
  tests/stripe-effects.test.mjs
do
  git cat-file -e "$BASE:$path"
done

if [ "$MODE" = "--verify" ]; then
  node tools/verify-provider-inbox.mjs --verify
  printf '%s\n' "provider inbox runtime rollback verified: $BASE"
  exit 0
fi

if [ "$MODE" = "--activate" ]; then
  STATUS=$(curl -sS -o /dev/null -w '%{http_code}' 'https://masest.co/api/admin/integrations')
  if [ "$STATUS" != "404" ]; then
    printf '%s\n' "rollback runtime not live: HTTP $STATUS" >&2
    exit 1
  fi
  node tools/verify-provider-inbox.mjs --rollback
  printf '%s\n' 'provider inbox entry points disabled; audit tables retained'
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
  CLOUDFLARE_PAGES.md \
  admin.html \
  docs/SHIPSTATION_API_FREE.md \
  functions/_lib/integration-effects.js \
  functions/_lib/shipstation.js \
  functions/api/admin/orders.js \
  functions/api/admin/qbo/status.js \
  functions/api/resend-webhook.js \
  functions/api/shipstation-webhook.js \
  js/admin.js \
  js/admin/orders.js \
  js/admin/qbo.js \
  js/admin/shipstation.js \
  tests/integration-effects.test.mjs \
  tests/admin-order-detail.test.mjs \
  tests/money-flow-handlers.test.mjs \
  tests/resend-webhook.test.mjs \
  tests/shipstation-webhook.test.mjs \
  tests/shipstation.test.mjs \
  tests/stripe-effects.test.mjs

rm -f \
  functions/_lib/qbo-webhook.js \
  functions/_lib/resend-inbound.js \
  functions/_lib/shipstation-tracking.js \
  functions/_lib/shipstation-tracking-ingest.js \
  functions/_lib/shipstation-webhook-auth.js \
  functions/api/admin/integrations.js \
  functions/api/qbo-webhook.js \
  js/admin/integration-health.js \
  tests/admin-integrations.test.mjs \
  tests/integration-provider-inbox.test.mjs \
  tests/qbo-webhook.test.mjs \
  tests/resend-inbound.test.mjs

printf '%s\n' 'provider inbox runtime/tests/docs prepared at rollback base'
printf '%s\n' 'activation artifacts preserved: tools/rollback-provider-inbox-runtime.sh, tools/verify-provider-inbox.mjs, supabase/{schema,rollback}-provider-inbox.sql'
printf '%s\n' 'next: npm test; commit; deploy; then run tools/rollback-provider-inbox-runtime.sh --activate'

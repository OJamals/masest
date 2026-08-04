#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BASE=${SHIPSTATION_FINANCIAL_ROLLBACK_BASE:-880e463a}
MODE=${1:---verify}

cd "$ROOT"
git cat-file -e "$BASE^{commit}"

if [ "$MODE" = "--verify" ]; then
  node tools/verify-provider-financial-ledger.mjs --verify
  git cat-file -e "$BASE:functions/_lib/shipstation-orders.js"
  git cat-file -e "$BASE:functions/api/admin/shipstation.js"
  printf '%s\n' "ShipStation finance rollback verified: $BASE"
  exit 0
fi

if [ "$MODE" = "--database" ]; then
  node tools/verify-provider-financial-ledger.mjs --rollback
  exit 0
fi

if [ "$MODE" != "--prepare-runtime" ]; then
  printf '%s\n' "usage: $0 [--verify|--database|--prepare-runtime]" >&2
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' 'runtime rollback requires a clean tracked worktree' >&2
  exit 1
fi

git restore --source="$BASE" -- \
  admin.html \
  functions/_lib/shipstation-orders.js \
  functions/api/admin/orders.js \
  functions/api/admin/shipstation.js \
  js/admin.js \
  js/admin/orders.js \
  supabase/schema-shipstation.sql \
  tests/admin-order-detail.test.mjs \
  tests/admin-event-delegation.test.mjs \
  tests/shipstation-admin.test.mjs \
  tests/shipstation-orders.test.mjs
rm -f \
  functions/_lib/order-financial-ledger.js \
  supabase/rollback-shipstation-financial-ledger.sql \
  tests/provider-financial-ledger.test.mjs \
  tools/verify-provider-financial-ledger.mjs

printf '%s\n' 'runtime rollback prepared; apply DB rollback after release cutover'

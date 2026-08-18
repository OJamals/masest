import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as quoteOrders from "../functions/_lib/quote-order.js";

const {
  finalizeQuoteOrder,
  markQuotePaymentPending,
  reopenQuoteAfterPaymentFailure,
} = quoteOrders;

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FINAL_ID = "33333333-3333-4333-8333-333333333333";
const REQUISITION_ID = "44444444-4444-4444-8444-444444444444";

function quoteOrderDb() {
  const state = {
    quote: {
      id: QUOTE_ID,
      payload: {
        requisition_id: "44444444-4444-4444-8444-444444444444",
        offer_order_id: DRAFT_ID,
        offer_status: "accepted",
        offer_expires_at: "2999-01-01T00:00:00.000Z",
      },
      status: "contacted",
      pipeline_stage: "proposal",
    },
    draft: { id: DRAFT_ID, status: "cart", requisition_name: null },
    beforeQuoteUpdate: null,
  };
  const calls = [];

  function builder(table) {
    const filters = [];
    let operation = "select";
    let patch = null;
    const api = {
      select() { return api; },
      update(value) { operation = "update"; patch = value; return api; },
      delete() { operation = "delete"; return api; },
      eq(column, value) { filters.push(["eq", column, value]); return api; },
      contains(column, value) { filters.push(["contains", column, value]); return api; },
      is(column, value) { filters.push(["is", column, value]); return api; },
      async maybeSingle() {
        if (table !== "quotes") return { data: null, error: null };
        if (operation === "update") return updateQuote();
        if (!matches(state.quote)) {
          return { data: null, error: null };
        }
        return { data: state.quote, error: null };
      },
      then(resolve) {
        if (operation === "update" && table === "quotes") {
          resolve(updateQuote());
          return;
        }
        if (operation === "delete" && table === "orders") {
          const matched = state.draft && matches(state.draft);
          calls.push(["draft.delete", matched]);
          if (matched) state.draft = null;
        }
        resolve({ error: null });
      },
    };

    function matches(row) {
      return Boolean(row) && filters.every(([operator, column, value]) => {
        if (operator === "contains") {
          return Object.entries(value).every(([key, expected]) => row[column]?.[key] === expected);
        }
        if (operator === "is" && column.startsWith("payload->>")) {
          return (row.payload?.[column.slice(10)] ?? null) === value;
        }
        return (row[column] ?? null) === value;
      });
    }

    function updateQuote() {
      if (state.beforeQuoteUpdate) {
        const beforeUpdate = state.beforeQuoteUpdate;
        state.beforeQuoteUpdate = null;
        beforeUpdate(state.quote);
      }
      const matched = matches(state.quote);
      calls.push(["quote.update", patch, matched]);
      if (matched) Object.assign(state.quote, patch);
      return { data: matched ? state.quote : null, error: null };
    }

    return api;
  }

  return { state, calls, db: { from: builder } };
}

test("finalizeQuoteOrder marks the canonical quote won and removes only its draft", async () => {
  const { state, calls, db } = quoteOrderDb();
  const result = await finalizeQuoteOrder(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
    at: "2026-07-28T20:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(state.quote.status, "closed");
  assert.equal(state.quote.pipeline_stage, "won");
  assert.equal(state.quote.payload.offer_status, "ordered");
  assert.equal(state.quote.payload.final_order_id, FINAL_ID);
  assert.equal(state.draft, null);
  assert.deepEqual(calls.map(([name]) => name), ["quote.update", "draft.delete"]);
});

test("finalizeQuoteOrder rejects a draft that is not bound to the quote", async () => {
  const { state, calls, db } = quoteOrderDb();
  state.quote.payload.offer_order_id = "55555555-5555-4555-8555-555555555555";
  const result = await finalizeQuoteOrder(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
  });

  assert.deepEqual(result, { error: "quote_order_mismatch" });
  assert.deepEqual(calls, []);
  assert.ok(state.draft);
});

test("finalizeQuoteOrder never rebinds an ordered quote to a second payment", async () => {
  const { state, calls, db } = quoteOrderDb();
  state.quote.payload.offer_status = "ordered";
  state.quote.payload.final_order_id = FINAL_ID;
  const result = await finalizeQuoteOrder(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: "66666666-6666-4666-8666-666666666666",
  });

  assert.deepEqual(result, { error: "quote_final_order_mismatch" });
  assert.deepEqual(calls, []);
  assert.ok(state.draft);
});

test("finalizeQuoteOrder rejects an ordered quote missing its final order identity", async () => {
  const { state, calls, db } = quoteOrderDb();
  state.quote.payload.offer_status = "ordered";
  const result = await finalizeQuoteOrder(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
  });

  assert.deepEqual(result, { error: "quote_final_order_mismatch" });
  assert.deepEqual(calls, []);
  assert.ok(state.draft);
});

test("accepted and payment-pending offers are immutable", () => {
  assert.equal(quoteOrders.requisitionQuoteMayBeSent({ status: "contacted", payload: { offer_status: "sent" } }), true);
  for (const offerStatus of ["accepted", "payment_pending", "ordered"]) {
    assert.equal(
      quoteOrders.requisitionQuoteMayBeSent({ status: "contacted", payload: { offer_status: offerStatus } }),
      false,
    );
  }
});

test("sending a revision is the explicit reactivation for declined or expired requisitions", () => {
  for (const offerStatus of ["declined", "expired"]) {
    assert.equal(quoteOrders.requisitionQuoteMayBeSent({
      source: "requisition",
      status: "closed",
      pipeline_stage: "lost",
      payload: { offer_status: offerStatus },
    }), true);
  }
  assert.equal(quoteOrders.requisitionQuoteMayBeSent({
    source: "requisition",
    status: "closed",
    pipeline_stage: "won",
    payload: { offer_status: "declined" },
  }), false);
});

test("offer-state guard makes absent and existing bindings compare-and-swap safe", () => {
  function queryLog() {
    const calls = [];
    const query = {
      contains(column, value) { calls.push(["contains", column, value]); return query; },
      is(column, value) { calls.push(["is", column, value]); return query; },
    };
    return { calls, query };
  }

  const empty = queryLog();
  assert.equal(quoteOrders.guardQuoteOffer(empty.query, {}), empty.query);
  assert.deepEqual(empty.calls, [
    ["is", "payload->>offer_order_id", null],
    ["is", "payload->>offer_status", null],
  ]);

  const sent = queryLog();
  assert.equal(quoteOrders.guardQuoteOffer(sent.query, {
    offer_order_id: DRAFT_ID,
    offer_status: "sent",
  }), sent.query);
  assert.deepEqual(sent.calls, [
    ["contains", "payload", { offer_order_id: DRAFT_ID }],
    ["contains", "payload", { offer_status: "sent" }],
  ]);
});

test("open requisition quote lookup protects its saved requisition", async () => {
  const filters = [];
  const quote = { id: QUOTE_ID, source: "requisition", status: "contacted", pipeline_stage: "new", payload: { requisition_id: REQUISITION_ID } };
  const query = {
    select() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    contains(column, value) { filters.push([column, value]); return this; },
    not(column, operator, value) { filters.push([column, operator, value]); return this; },
    or(value) { filters.push(["or", value]); return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: quote, error: null }; },
  };
  const result = await quoteOrders.findOpenRequisitionQuote(
    { from(table) { assert.equal(table, "quotes"); return query; } },
    REQUISITION_ID,
  );

  assert.deepEqual(result, { quote, staleQuote: null, error: null });
  assert.deepEqual(filters, [
    ["source", "requisition"],
    ["payload", { requisition_id: REQUISITION_ID }],
    ["status", "in", "(closed,spam)"],
    ["or", "pipeline_stage.is.null,pipeline_stage.not.in.(lost,won)"],
    ["or", "payload->>offer_status.is.null,payload->>offer_status.not.in.(declined,expired,ordered)"],
  ]);
});

test("expired SQL-open rows are returned as stale snapshots for pre-insert transition", async () => {
  const quote = {
    id: QUOTE_ID,
    source: "requisition",
    status: "contacted",
    pipeline_stage: "proposal",
    payload: {
      requisition_id: REQUISITION_ID,
      offer_order_id: DRAFT_ID,
      offer_status: "sent",
      offer_expires_at: "2020-01-01T00:00:00.000Z",
    },
  };
  const query = {
    select() { return this; },
    eq() { return this; },
    contains() { return this; },
    not() { return this; },
    or() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: quote, error: null }; },
  };
  const result = await quoteOrders.findOpenRequisitionQuote({ from: () => query }, REQUISITION_ID);
  assert.deepEqual(result, { quote: null, staleQuote: quote, error: null });
});

test("open requisition quotes are database-unique and duplicate races are recognized", () => {
  const schema = readFileSync(new URL("../supabase/schema-quotes.sql", import.meta.url), "utf8");
  const lifecycleSchema = readFileSync(new URL("../supabase/schema-quote-lifecycle.sql", import.meta.url), "utf8");
  assert.match(schema, /quotes_open_requisition_unique_idx/);
  assert.match(lifecycleSchema, /coalesce\(pipeline_stage, 'new'\) not in \('lost', 'won'\)/);
  assert.match(schema, /payload\s*->>\s*'requisition_id'/);
  assert.match(schema, /status\s+not\s+in\s*\(\s*'closed'\s*,\s*'spam'\s*\)/);
  assert.match(schema, /offer_status[\s\S]*declined[\s\S]*expired[\s\S]*ordered/);
  assert.equal(quoteOrders.isOpenRequisitionQuoteConflict({
    code: "23505",
    message: 'duplicate key value violates unique constraint "quotes_open_requisition_unique_idx"',
  }), true);
  assert.equal(quoteOrders.isOpenRequisitionQuoteConflict({
    code: "23505",
    message: 'duplicate key value violates unique constraint "quotes_pkey"',
  }), false);
});

test("ACH quote stays bound to its draft while pending and reopens after failure", async () => {
  const { state, calls, db } = quoteOrderDb();
  const pending = await markQuotePaymentPending(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
    at: "2026-07-28T20:00:00.000Z",
  });
  assert.deepEqual(pending, { ok: true });
  assert.equal(state.quote.payload.offer_status, "payment_pending");
  assert.equal(state.quote.payload.final_order_id, FINAL_ID);
  assert.ok(state.draft, "pending ACH must retain the checkout draft");

  const reopened = await reopenQuoteAfterPaymentFailure(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
    at: "2026-07-29T20:00:00.000Z",
  });
  assert.deepEqual(reopened, { ok: true });
  assert.equal(state.quote.payload.offer_status, "accepted");
  assert.equal(state.quote.payload.final_order_id, undefined);
  assert.ok(state.draft, "failed ACH must leave the accepted quote retryable");
  assert.deepEqual(calls.map(([name]) => name), ["quote.update", "quote.update"]);
});

test("payment failure after the exact offer boundary expires instead of reopening", async () => {
  const { state, db } = quoteOrderDb();
  state.quote.payload.offer_status = "payment_pending";
  state.quote.payload.final_order_id = FINAL_ID;
  state.quote.payload.offer_expires_at = "2026-08-17T12:00:00.000Z";

  const result = await reopenQuoteAfterPaymentFailure(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
    at: "2026-08-17T12:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(state.quote.payload.offer_status, "expired");
  assert.equal(state.quote.payload.final_order_id, undefined);
});

test("quote transitions never overwrite a concurrent ordered state", async () => {
  for (const transition of [
    markQuotePaymentPending,
    reopenQuoteAfterPaymentFailure,
    finalizeQuoteOrder,
  ]) {
    const { state, calls, db } = quoteOrderDb();
    if (transition === reopenQuoteAfterPaymentFailure) {
      state.quote.payload.offer_status = "payment_pending";
      state.quote.payload.final_order_id = FINAL_ID;
    }
    state.beforeQuoteUpdate = (quote) => {
      quote.payload = {
        ...quote.payload,
        offer_status: "ordered",
        final_order_id: FINAL_ID,
      };
      quote.status = "closed";
      quote.pipeline_stage = "won";
    };

    const result = await transition(db, {
      quoteId: QUOTE_ID,
      draftOrderId: DRAFT_ID,
      finalOrderId: FINAL_ID,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(state.quote.payload.offer_status, "ordered");
    assert.equal(state.quote.status, "closed");
    assert.equal(state.quote.pipeline_stage, "won");
    if (transition === finalizeQuoteOrder) {
      assert.equal(state.draft, null);
    } else {
      assert.ok(state.draft);
    }
    assert.equal(calls[0][2], false, `${transition.name} must use compare-and-swap filters`);
  }
});

test("markQuotePaymentPending accepts a concurrent identical transition", async () => {
  const { state, calls, db } = quoteOrderDb();
  state.beforeQuoteUpdate = (quote) => {
    quote.payload = {
      ...quote.payload,
      offer_status: "payment_pending",
      final_order_id: FINAL_ID,
    };
  };

  const result = await markQuotePaymentPending(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(state.quote.payload.offer_status, "payment_pending");
  assert.equal(state.quote.payload.final_order_id, FINAL_ID);
  assert.equal(calls[0][2], false);
});

test("finalizeQuoteOrder never overwrites a concurrent different final order", async () => {
  const otherFinalId = "66666666-6666-4666-8666-666666666666";
  const { state, calls, db } = quoteOrderDb();
  state.beforeQuoteUpdate = (quote) => {
    quote.payload = {
      ...quote.payload,
      offer_status: "ordered",
      final_order_id: otherFinalId,
    };
  };

  const result = await finalizeQuoteOrder(db, {
    quoteId: QUOTE_ID,
    draftOrderId: DRAFT_ID,
    finalOrderId: FINAL_ID,
  });

  assert.deepEqual(result, { error: "quote_final_order_mismatch" });
  assert.equal(state.quote.payload.final_order_id, otherFinalId);
  assert.ok(state.draft);
  assert.equal(calls[0][2], false);
});

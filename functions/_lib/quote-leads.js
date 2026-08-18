import { stagePatch } from './crm-pipeline.js';
import {
  buildConvertItems,
  netOrderRow,
  quoteOrderRow,
  quotePayloadWithOffer,
} from './quote-convert.js';
import { guardQuoteOffer, requisitionQuoteMayBeSent } from './quote-order.js';
import { companyEmails } from './supabase.js';
import { quoteOfferEffects, toIntegrationEffectRows } from './integration-effects.js';
import {
  canTransitionOffer,
  offerExpiryReached,
  quoteDeliveryState,
  quoteExpirationPatch,
  staffTerminalTransitionConflict,
} from './quote-lifecycle.js';

const STATUSES = ['new', 'contacted', 'closed', 'spam'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATION_SELECT = 'id,source,payload,status,notes,handled_at,priority,next_step,due_at,lead_score,assigned_to,assigned_at,pipeline_stage,deal_value,expected_close,lost_reason,contact_id,email,product,company,type';

function dueAt(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date.toISOString();
}

function transitionPatch(changes, actor, now) {
  const patch = {};
  if (changes.status) {
    if (!STATUSES.includes(changes.status)) return { error: 'invalid_status' };
    patch.status = changes.status;
    patch.handled_at = changes.status === 'new' ? null : now.toISOString();
    patch.handled_by = changes.status === 'new' ? null : (actor || null);
  }
  if (changes.priority) {
    if (!PRIORITIES.includes(changes.priority)) return { error: 'invalid_priority' };
    patch.priority = changes.priority;
  }
  if (typeof changes.assigned_to === 'string') {
    const assignedTo = changes.assigned_to.trim().slice(0, 160);
    Object.assign(patch, {
      assigned_to: assignedTo || null,
      assigned_at: assignedTo ? now.toISOString() : null,
    });
  }
  if (typeof changes.notes === 'string') patch.notes = changes.notes.slice(0, 4000);
  if (typeof changes.next_step === 'string') patch.next_step = changes.next_step.slice(0, 500);
  return { patch };
}

function dealPatch(changes) {
  const patch = {};
  if (changes.deal_value !== undefined) {
    if (changes.deal_value === null || changes.deal_value === '') patch.deal_value = null;
    else {
      const value = Number(changes.deal_value);
      if (!Number.isFinite(value) || value < 0) return { error: 'invalid_deal_value' };
      patch.deal_value = value;
    }
  }
  if (changes.expected_close !== undefined) {
    patch.expected_close = changes.expected_close ? String(changes.expected_close).slice(0, 10) : null;
  }
  if (changes.contact_id !== undefined) {
    patch.contact_id = changes.contact_id === null || changes.contact_id === ''
      ? null
      : (Number(changes.contact_id) || null);
  }
  const parsedDueAt = dueAt(changes.due_at);
  if (parsedDueAt === false) return { error: 'invalid_due_at' };
  if (parsedDueAt !== undefined) patch.due_at = parsedDueAt;
  return { patch };
}

function failure(error) {
  return { ok: false, error: error?.message || String(error), storage_error: true };
}

function batchLimit(value) {
  const requested = Number(value || 25);
  return Math.min(50, Math.max(1, Math.floor(requested) || 25));
}

function plusDays(days, base) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function appendNote(existing, note) {
  return [existing, note].filter(Boolean).join('\n').slice(0, 4000);
}

function offerExpiry(value, now) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp > now.getTime()
    ? new Date(timestamp).toISOString()
    : null;
}

export function createQuoteLeadLifecycle({
  store,
  stageChanged = async () => {},
  sendFollowUp = async () => {},
  handoff = async () => ({ posted: false, reason: 'not_configured' }),
  sendDueNotice = async () => false,
  converted = async () => {},
  audit = async () => {},
  prepareCheckoutChange = null,
  releaseCheckoutChange = async () => {},
  now = () => new Date(),
} = {}) {
  if (!store) throw new Error('quote_lead_store_required');

  async function update({ id, changes = {}, actor } = {}) {
    if (!id) return { ok: false, error: 'id_required' };
    const at = now();
    const transition = transitionPatch(changes, actor, at);
    if (transition.error) return { ok: false, error: transition.error };
    const deal = dealPatch(changes);
    if (deal.error) return { ok: false, error: deal.error };
    const patch = { ...transition.patch, ...deal.patch };
    let stageActuallyChanged = false;

    try {
      const requestsTerminal = ['closed', 'spam'].includes(changes.status)
        || ['won', 'lost'].includes(changes.pipeline_stage);
      let terminalSnapshot = null;
      if (requestsTerminal) {
        terminalSnapshot = await store.lifecycleQuote(id);
        if (!terminalSnapshot) return { ok: false, error: 'quote_not_found', status: 404 };
        if (staffTerminalTransitionConflict(terminalSnapshot, changes, at.getTime())) {
          return { ok: false, error: 'live_offer_requires_resolution', status: 409 };
        }
      }
      if (changes.pipeline_stage !== undefined) {
        const currentStage = await store.currentStage(id);
        stageActuallyChanged = (currentStage || 'new') !== changes.pipeline_stage;
        if (stageActuallyChanged) {
          const stage = stagePatch({
            stage: changes.pipeline_stage,
            lost_reason: changes.lost_reason,
            actor: actor || null,
          }, at);
          if (stage.error) return { ok: false, error: stage.error };
          Object.assign(patch, stage.patch);
          if (['won', 'lost'].includes(changes.pipeline_stage)) {
            Object.assign(patch, {
              status: 'closed',
              handled_at: at.toISOString(),
              handled_by: actor || null,
            });
          }
        }
      }
      if (!Object.keys(patch).length) return { ok: false, error: 'nothing_to_update' };

      const quote = terminalSnapshot
        ? await store.updateQuoteIfCurrent(id, patch, terminalSnapshot)
        : await store.updateQuote(id, patch);
      if (terminalSnapshot && !quote) {
        return { ok: false, error: 'quote_changed', status: 409 };
      }
      if (stageActuallyChanged && quote?.email) {
        await Promise.allSettled([stageChanged(quote, changes.pipeline_stage, 'pipeline')]);
      }
      return { ok: true, quote };
    } catch (error) {
      return failure(error);
    }
  }

  async function bulkUpdate({ ids = [], changes = {}, actor } = {}) {
    const selectedIds = ids.slice(0, 200);
    if (!selectedIds.length) return { ok: false, error: 'id_required' };
    const at = now();
    const transition = transitionPatch(changes, actor, at);
    if (transition.error) return { ok: false, error: transition.error };
    const bulk = transition.patch;
    let stage = null;

    if (changes.pipeline_stage !== undefined) {
      stage = stagePatch({
        stage: changes.pipeline_stage,
        lost_reason: changes.lost_reason,
        actor: actor || null,
      }, at);
      if (stage.error) return { ok: false, error: stage.error };
    }
    if (!Object.keys(bulk).length && !stage) return { ok: false, error: 'nothing_to_update' };

    try {
      const quotes = changes.pipeline_stage !== undefined
        || ['closed', 'spam'].includes(changes.status)
        ? await store.quotesForStage(selectedIds)
        : [];
      if (quotes.some((quote) => staffTerminalTransitionConflict(quote, changes, at.getTime()))) {
        return { ok: false, error: 'live_offer_requires_resolution', status: 409 };
      }
      if (stage && ['won', 'lost'].includes(changes.pipeline_stage)) {
        Object.assign(stage.patch, {
          status: 'closed',
          handled_at: at.toISOString(),
          handled_by: actor || null,
        });
      }
      const terminal = ['closed', 'spam'].includes(changes.status)
        || ['won', 'lost'].includes(changes.pipeline_stage);
      if (terminal) {
        const terminalPatch = { ...bulk, ...(stage?.patch || {}) };
        const updated = await Promise.all(quotes.map((quote) => (
          store.updateQuoteIfCurrent(quote.id, terminalPatch, quote)
        )));
        if (updated.some((quote) => !quote)) {
          return { ok: false, error: 'quote_changed', status: 409 };
        }
        const moved = stage
          ? quotes.filter((quote) => (quote.pipeline_stage || 'new') !== changes.pipeline_stage)
          : [];
        if (stage) {
          await Promise.allSettled(moved
            .filter((quote) => quote.email)
            .map((quote) => stageChanged(quote, changes.pipeline_stage, 'pipeline_bulk')));
        }
        return {
          ok: true,
          updated: selectedIds.length,
          stage_moved: stage ? moved.length : undefined,
        };
      }
      if (Object.keys(bulk).length) await store.updateQuotes(selectedIds, bulk);
      let moved = [];
      if (stage) {
        moved = quotes.filter((quote) => (quote.pipeline_stage || 'new') !== changes.pipeline_stage);
        if (moved.length) {
          await store.updateQuotes(moved.map((quote) => quote.id), stage.patch);
          await Promise.allSettled(moved
            .filter((quote) => quote.email)
            .map((quote) => stageChanged(quote, changes.pipeline_stage, 'pipeline_bulk')));
        }
      }
      return {
        ok: true,
        updated: selectedIds.length,
        stage_moved: stage ? moved.length : undefined,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async function followUp({
    id,
    actor,
    companyId,
    subject,
    nextStep: requestedNextStep,
    dueAt: requestedDueAt,
  } = {}) {
    if (!id) return { ok: false, error: 'id_required' };
    try {
      const quote = await store.quoteForFollowUp(id);
      if (!quote) return { ok: false, error: 'quote_not_found', status: 404 };
      if (!quote.email) return { ok: false, error: 'quote_email_required', status: 400 };

      const nextStep = String(requestedNextStep || quote.next_step
        || 'We are reviewing your request and will follow up with next steps.').slice(0, 500);
      const due = dueAt(requestedDueAt ?? quote.due_at);
      if (due === false) return { ok: false, error: 'invalid_due_at', status: 400 };
      const dueText = due
        ? new Date(due).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        })
        : null;

      await sendFollowUp({ quote, nextStep, due, dueText, subject, actor });
      const thread = await handoff({
        quote,
        companyId,
        text: nextStep,
        actor: actor || 'staff',
      });
      const handoffNote = thread.posted
        ? `Buyer message thread updated (${thread.message_id || 'message'})`
        : `Buyer message thread not updated (${thread.reason || thread.error || 'no account match'})`;
      const notes = [
        quote.notes,
        `Follow-up sent by ${actor || 'staff'}: ${nextStep}`,
        handoffNote,
      ].filter(Boolean).join('\n');
      const updated = await store.updateFollowUp(id, {
        status: quote.status === 'closed' ? quote.status : 'contacted',
        handled_at: now().toISOString(),
        handled_by: actor || null,
        next_step: 'Follow-up sent',
        due_at: due || null,
        notes: notes.slice(0, 4000),
      });
      return { ok: true, quote: updated };
    } catch (error) {
      return failure(error);
    }
  }

  async function expireDue({ batch } = {}) {
    const at = now();
    const nowIso = at.toISOString();
    try {
      const candidates = await store.expirableOffers(nowIso, batchLimit(batch));
      let expired_offers = 0;
      for (const quote of candidates) {
        if (!offerExpiryReached(quote, at.getTime())) continue;
        const expired = await store.expireOffer({
          quote,
          patch: quoteExpirationPatch(quote, nowIso),
        });
        if (expired) expired_offers += 1;
      }
      return { ok: true, expired_offers };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function sweepDue({ actor, batch } = {}) {
    const at = now();
    const nowIso = at.toISOString();
    try {
      const expired = await expireDue({ batch });
      if (!expired.ok) return expired;
      const quotes = await store.dueQuotes(nowIso, batchLimit(batch));
      const results = [];
      let buyer_reminders = 0;
      let staff_alerts = 0;

      for (const quote of quotes) {
        const label = quote.company || quote.name || quote.email || quote.id;
        const nextStep = quote.next_step || 'We are checking in on your quote request.';
        const dueText = quote.due_at
          ? new Date(quote.due_at).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/New_York',
          })
          : 'now';
        const hasBuyerEmail = Boolean(quote.email);
        const sent = await sendDueNotice({
          quote,
          label,
          nextStep,
          dueText,
          hasBuyerEmail,
        });
        if (hasBuyerEmail) buyer_reminders += 1;
        else staff_alerts += 1;

        const note = `Automated due follow-up by ${actor}: ${hasBuyerEmail ? 'buyer reminder' : 'staff alert'} ${sent ? 'sent' : 'attempted'} for ${nextStep}`;
        const updateError = await store.updateDueQuote(quote.id, {
          status: quote.status === 'new' ? 'contacted' : quote.status,
          handled_at: nowIso,
          handled_by: actor,
          next_step: hasBuyerEmail ? 'Automated reminder sent' : 'Staff alert sent',
          due_at: plusDays(hasBuyerEmail ? 2 : 1, at),
          notes: appendNote(quote.notes, note),
        });
        results.push({
          id: quote.id,
          ok: !updateError,
          emailed: sent,
          error: updateError || undefined,
        });
      }
      return {
        ok: true,
        processed: quotes.length,
        buyer_reminders,
        staff_alerts,
        expired_offers: expired.expired_offers,
        results,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function workspace({ id } = {}) {
    if (!UUID.test(String(id || ''))) {
      return { status: 400, body: { error: 'invalid_id' } };
    }
    try {
      let quote = await store.workspaceQuote(id);
      if (!quote) return { status: 404, body: { error: 'not_found' } };
      if (offerExpiryReached(quote, now().getTime())) {
        const patch = quoteExpirationPatch(quote, now().toISOString());
        const transitioned = await store.expireOffer({ quote, patch });
        quote = transitioned
          ? { ...quote, ...patch, ...transitioned }
          : (await store.workspaceQuote(id) || quote);
      }
      const requisitionId = String(quote.payload?.requisition_id || '');
      const requesterId = String(quote.payload?.requester_id || '');
      const companyId = String(quote.payload?.company_id || '');
      if (quote.source !== 'requisition' || !UUID.test(requisitionId)
        || !UUID.test(requesterId) || !UUID.test(companyId)) {
        return { status: 409, body: { error: 'workspace_unavailable' } };
      }

      const offerOrderId = String(quote.payload?.offer_order_id || '');
      const data = await store.workspaceData({
        requisitionId,
        requesterId,
        companyId,
        offerOrderId: UUID.test(offerOrderId) ? offerOrderId : null,
      });
      if (!data.requisition) {
        return { status: 409, body: { error: 'requisition_unavailable' } };
      }
      const deliveryEffects = quote.payload?.offer_delivery_event_id
        ? await store.deliveryEffects(quote.payload.offer_delivery_event_id)
        : [];
      const pricedOrder = data.offer || data.requisition;
      return {
        status: 200,
        body: {
          workspace: {
            quote_id: quote.id,
            company_id: companyId,
            requester_id: requesterId,
            requisition_id: data.requisition.id,
            requisition_name: data.requisition.requisition_name,
            offer_order_id: data.offer?.id || null,
            offer_status: quote.payload?.offer_status || null,
            offer_expires_at: quote.payload?.offer_expires_at || null,
            delivery_state: quoteDeliveryState(deliveryEffects),
            currency: pricedOrder.currency || 'usd',
            subtotal: Number(pricedOrder.subtotal || 0),
            total: Number(pricedOrder.total || 0),
            items: pricedOrder.order_items || [],
            messages: data.messages || [],
            documents: data.documents || [],
          },
        },
      };
    } catch (error) {
      return { status: 500, body: { error: error?.message || String(error) } };
    }
  }

  async function sendOffer({ id, items, expiresAt: requestedExpiresAt, actor, user } = {}) {
    let order = null;
    let committed = false;
    let checkoutMutation = null;
    let checkoutMutationIdentity = null;
    try {
      const atDate = now();
      const expiresAt = offerExpiry(requestedExpiresAt, atDate);
      if (!expiresAt) return { status: 400, body: { error: 'future_offer_expiry_required' } };
      const quote = await store.offerQuote(id);
      if (!quote) return { status: 404, body: { error: 'quote_not_found' } };
      if (!requisitionQuoteMayBeSent(quote, atDate.getTime())) {
        return { status: 409, body: { error: 'quote_closed' } };
      }
      const requisitionId = String(quote.payload?.requisition_id || '');
      const requesterId = String(quote.payload?.requester_id || '');
      const companyId = String(quote.payload?.company_id || '');
      if (quote.source !== 'requisition' || !UUID.test(requisitionId)
        || !UUID.test(requesterId) || !UUID.test(companyId)) {
        return { status: 409, body: { error: 'invalid_requisition_quote' } };
      }

      const requisition = await store.requisition({ requisitionId, requesterId, companyId });
      if (!requisition) return { status: 409, body: { error: 'requisition_unavailable' } };
      const built = buildConvertItems(items);
      if (built.error) return { status: 400, body: { error: built.error } };
      const sourceBySku = new Map((requisition.order_items || [])
        .map((item) => [item.sku, item]));
      if (built.items.some((item) => !sourceBySku.has(item.sku))) {
        return { status: 400, body: { error: 'item_not_in_requisition' } };
      }
      const clean = built.items.map((item) => ({
        ...item,
        product_sku: sourceBySku.get(item.sku)?.product_sku || item.product_sku,
        name: sourceBySku.get(item.sku)?.name || item.name,
      }));
      const currency = String(requisition.currency || 'usd').toLowerCase();
      order = await store.createOrder(quoteOrderRow({
        companyId,
        userId: requesterId,
        email: String(quote.email || '').toLowerCase(),
        subtotal: built.subtotal,
        currency,
      }));
      await store.insertOrderItems(order.id, clean);

      const at = atDate.toISOString();
      const previousOfferOrderId = String(quote.payload?.offer_order_id || '');
      const nextOfferStatus = quote.payload?.offer_status ? 'revised' : 'sent';
      if (!canTransitionOffer(quote, nextOfferStatus, atDate.getTime())) {
        await store.deleteOrder(order.id);
        return { status: 409, body: { error: 'quote_changed' } };
      }
      if (UUID.test(previousOfferOrderId)) {
        if (!prepareCheckoutChange || !Number.isSafeInteger(Number(quote.offer_revision))
          || Number(quote.offer_revision) < 1) {
          await store.deleteOrder(order.id);
          return { status: 503, body: { error: 'quote_checkout_attempt_unavailable', retryable: true } };
        }
        try {
          checkoutMutationIdentity = {
            quoteId: quote.id,
            quoteOrderId: previousOfferOrderId,
            requesterId,
            companyId,
            offerRevision: Number(quote.offer_revision),
            offerStatus: String(quote.payload?.offer_status || ''),
          };
          checkoutMutation = await prepareCheckoutChange({
            kind: 'revise',
            identity: checkoutMutationIdentity,
          });
        } catch (error) {
          await store.deleteOrder(order.id);
          return {
            status: Number(error?.status) || 503,
            body: {
              error: error?.code || 'quote_checkout_attempt_unavailable',
              ...(error?.retryable ? { retryable: true } : {}),
            },
          };
        }
        if (!UUID.test(String(checkoutMutation?.mutationId || ''))) {
          await store.deleteOrder(order.id);
          return { status: 503, body: { error: 'quote_checkout_attempt_unavailable', retryable: true } };
        }
      }
      const payload = quotePayloadWithOffer(quote.payload, {
        orderId: order.id,
        status: nextOfferStatus,
        at,
        expiresAt,
      });
      const effects = toIntegrationEffectRows(quoteOfferEffects({
        quoteId: quote.id,
        companyId,
        email: quote.email,
        product: quote.product,
      }));
      const updated = await store.commitOffer({
        quote,
        payload,
        orderId: order.id,
        actor,
        dealValue: built.subtotal,
        expiresAt,
        eventId: `quote:${quote.id}:${order.id}`,
        effects,
        checkoutMutationId: checkoutMutation?.mutationId || null,
      });
      if (!updated) {
        if (checkoutMutation?.mutationId) {
          await releaseCheckoutChange({
            mutationId: checkoutMutation.mutationId,
            identity: checkoutMutationIdentity,
          }).catch(() => {});
        }
        await store.deleteOrder(order.id);
        return { status: 409, body: { error: 'quote_changed' } };
      }
      committed = true;

      if (UUID.test(previousOfferOrderId) && previousOfferOrderId !== order.id) {
        await store.deleteOrder(previousOfferOrderId, {
          companyId,
          requesterId,
          status: 'cart',
          requisitionName: null,
        }).catch(() => {});
      }
      await Promise.allSettled([audit({
        user,
        action: nextOfferStatus === 'revised' ? 'quote.revise' : 'quote.send',
        targetType: 'quote',
        targetId: quote.id,
        detail: {
          company_id: companyId,
          order_id: order.id,
          subtotal: built.subtotal,
          expires_at: expiresAt,
          delivery: 'queued',
        },
      })]);
      return {
        status: 202,
        body: { ok: true, order_id: order.id, quote: updated, delivery_state: 'queued' },
      };
    } catch (error) {
      if (checkoutMutation?.mutationId && !committed) {
        await releaseCheckoutChange({
          mutationId: checkoutMutation.mutationId,
          identity: checkoutMutationIdentity,
        }).catch(() => {});
      }
      if (order && !committed) await store.deleteOrder(order.id).catch(() => {});
      if (error?.code === '23505' && /quotes_open_requisition_unique_idx/.test(error?.message || '')) {
        return { status: 409, body: { error: 'open_quote_exists' } };
      }
      return { status: 500, body: { error: error?.message || String(error) } };
    }
  }

  async function convert({
    id,
    companyId: requestedCompanyId,
    items,
    actor,
    user,
    appUrl,
  } = {}) {
    const companyId = String(requestedCompanyId || '');
    try {
      const company = await store.company(companyId);
      if (!company) return { status: 404, body: { error: 'company_not_found' } };
      const built = buildConvertItems(items);
      if (built.error) return { status: 400, body: { error: built.error } };

      const order = await store.createOrder(netOrderRow(companyId, built.subtotal));
      await store.insertOrderItems(order.id, built.items);
      const at = now().toISOString();
      await store.markConverted(id, {
        status: 'closed',
        pipeline_stage: 'won',
        stage_changed_at: at,
        handled_at: at,
        handled_by: actor || null,
        next_step: 'Converted to order',
        due_at: null,
      });
      await store.notify({
        company_id: companyId,
        type: 'order',
        title: 'Order created from your quote',
        body: 'We turned your quote request into an order. See it in your dashboard.',
        link: '/dashboard.html#orders',
      });

      const quote = await store.convertedQuote(id);
      const recipients = [...new Set([
        ...(await store.orderRecipients(companyId)),
        String(quote?.email || '').trim(),
      ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
      if (recipients.length) await converted({ quote, recipients, appUrl });
      if (quote?.email) await Promise.allSettled([
        stageChanged(quote, 'won', 'quote_convert'),
      ]);
      await audit({
        user,
        action: 'quote.convert',
        targetType: 'quote',
        targetId: id,
        detail: { company_id: companyId, order_id: order.id, subtotal: built.subtotal },
      });
      return { status: 200, body: { ok: true, order_id: order.id } };
    } catch (error) {
      return { status: 500, body: { error: error?.message || String(error) } };
    }
  }

  return {
    update,
    bulkUpdate,
    followUp,
    expireDue,
    sweepDue,
    workspace,
    sendOffer,
    convert,
  };
}

function checked(result) {
  if (result.error) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}

export function createSupabaseQuoteLeadStore(sb) {
  if (!sb) throw new Error('supabase_client_required');
  return {
    async currentStage(id) {
      const data = checked(await sb.from('quotes').select('pipeline_stage').eq('id', id).single());
      return data?.pipeline_stage || null;
    },
    async lifecycleQuote(id) {
      return checked(await sb.from('quotes')
        .select('id,source,status,pipeline_stage,payload')
        .eq('id', id)
        .maybeSingle());
    },
    async updateQuote(id, patch) {
      return checked(await sb.from('quotes').update(patch).eq('id', id).select(MUTATION_SELECT).single());
    },
    async updateQuoteIfCurrent(id, patch, current) {
      let currentQuery = sb.from('quotes').update(patch)
        .eq('id', id)
        .eq('status', current.status);
      currentQuery = current.pipeline_stage == null
        ? currentQuery.is('pipeline_stage', null)
        : currentQuery.eq('pipeline_stage', current.pipeline_stage);
      let query = guardQuoteOffer(currentQuery, current.payload);
      query = current.source
        ? query.eq('source', current.source)
        : query.is('source', null);
      return checked(await query.select(MUTATION_SELECT).maybeSingle());
    },
    async quotesForStage(ids) {
      return checked(await sb.from('quotes')
        .select('id,source,status,payload,email,pipeline_stage,deal_value,product,company,type')
        .in('id', ids)) || [];
    },
    async updateQuotes(ids, patch) {
      checked(await sb.from('quotes').update(patch).in('id', ids));
    },
    async quoteForFollowUp(id) {
      const { data, error } = await sb.from('quotes')
        .select('id,name,email,company,status,priority,next_step,due_at,notes')
        .eq('id', id)
        .single();
      return error ? null : data;
    },
    async updateFollowUp(id, patch) {
      return checked(await sb.from('quotes').update(patch).eq('id', id)
        .select('id,status,notes,handled_at,priority,next_step,due_at,lead_score,assigned_to,assigned_at,pipeline_stage,deal_value,expected_close,lost_reason')
        .single());
    },
    async dueQuotes(nowIso, limit) {
      return checked(await sb.from('quotes')
        .select('id,name,email,company,status,priority,next_step,due_at,notes')
        .lte('due_at', nowIso)
        .neq('status', 'closed')
        .neq('status', 'spam')
        .order('due_at', { ascending: true })
        .limit(limit)) || [];
    },
    async expirableOffers(nowIso, limit) {
      return checked(await sb.from('quotes')
        .select('id,source,status,pipeline_stage,payload')
        .in('payload->>offer_status', ['sent', 'revised', 'accepted'])
        // Query only rows that may already be due so a large set of older future offers
        // cannot starve newer expired offers behind the bounded sweep page. Missing
        // validity is included and fails closed in the canonical lifecycle predicate.
        .or(`payload->>offer_expires_at.is.null,payload->>offer_expires_at.lte.${nowIso}`)
        .order('payload->>offer_expires_at', { ascending: true, nullsFirst: true })
        .limit(limit)) || [];
    },
    async expireOffer({ quote, patch }) {
      let update = sb.from('quotes').update(patch).eq('id', quote.id).eq('status', quote.status);
      update = quote.pipeline_stage == null
        ? update.is('pipeline_stage', null)
        : update.eq('pipeline_stage', quote.pipeline_stage);
      const query = guardQuoteOffer(update, quote.payload);
      return checked(await query.select('id,payload').maybeSingle());
    },
    async updateDueQuote(id, patch) {
      const { error } = await sb.from('quotes').update(patch).eq('id', id);
      return error?.message || null;
    },
    async workspaceQuote(id) {
      return checked(await sb.from('quotes')
        .select('id,source,payload,email,company,product,status,pipeline_stage')
        .eq('id', id)
        .maybeSingle());
    },
    async deliveryEffects(eventId) {
      return checked(await sb.from('integration_effects')
        .select('status,provider_result')
        .eq('event_id', eventId)) || [];
    },
    async workspaceData({
      requisitionId,
      requesterId,
      companyId,
      offerOrderId,
    }) {
      const requisitionQuery = sb.from('orders')
        .select('id,company_id,user_id,requisition_name,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
        .eq('id', requisitionId)
        .eq('company_id', companyId)
        .eq('user_id', requesterId)
        .eq('status', 'cart')
        .not('requisition_name', 'is', null)
        .maybeSingle();
      const offerQuery = offerOrderId
        ? sb.from('orders')
          .select('id,company_id,user_id,subtotal,total,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
          .eq('id', offerOrderId)
          .eq('company_id', companyId)
          .eq('user_id', requesterId)
          .eq('status', 'cart')
          .is('requisition_name', null)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const messagesQuery = sb.from('messages')
        .select('id,sender_role,body,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50);
      const documentsQuery = sb.from('technical_document_requests')
        .select('id,status,created_at,document_id,document_revision,requested_from,technical_documents(title,document_type)')
        .eq('requester_id', requesterId)
        .order('created_at', { ascending: false })
        .limit(50);
      const [requisition, offer, messages, documents] = await Promise.all([
        requisitionQuery,
        offerQuery,
        messagesQuery,
        documentsQuery,
      ]);
      const error = requisition.error || offer.error || messages.error || documents.error;
      if (error) throw new Error(error.message);
      return {
        requisition: requisition.data,
        offer: offer.data,
        messages: messages.data || [],
        documents: documents.data || [],
      };
    },
    async offerQuote(id) {
      return checked(await sb.from('quotes')
        .select('id,source,payload,email,company,product,status,pipeline_stage,offer_revision,checkout_mutation_id,checkout_mutation_kind')
        .eq('id', id)
        .maybeSingle());
    },
    async requisition({ requisitionId, requesterId, companyId }) {
      return checked(await sb.from('orders')
        .select('id,company_id,user_id,currency,order_items(sku,product_sku,name,qty,unit_price,line_total)')
        .eq('id', requisitionId)
        .eq('company_id', companyId)
        .eq('user_id', requesterId)
        .eq('status', 'cart')
        .not('requisition_name', 'is', null)
        .maybeSingle());
    },
    async createOrder(row) {
      return checked(await sb.from('orders').insert(row).select('id').single());
    },
    async insertOrderItems(orderId, items) {
      checked(await sb.from('order_items')
        .insert(items.map((item) => ({ order_id: orderId, ...item }))));
    },
    async commitOffer({
      quote,
      payload,
      orderId,
      actor,
      dealValue,
      expiresAt,
      eventId,
      effects,
      checkoutMutationId,
    }) {
      return checked(await sb.rpc('commit_quote_offer', {
        p_quote_id: quote.id,
        p_expected_status: quote.status,
        p_expected_offer_order_id: quote.payload?.offer_order_id || null,
        p_expected_offer_status: quote.payload?.offer_status || null,
        p_offer_order_id: orderId,
        p_payload: payload,
        p_actor: actor || null,
        p_deal_value: dealValue,
        p_expires_at: expiresAt,
        p_event_id: eventId,
        p_effects: effects,
        p_expected_offer_revision: Number(quote.offer_revision),
        p_checkout_mutation_id: checkoutMutationId || null,
      }));
    },
    async deleteOrder(id, scope = {}) {
      let query = sb.from('orders').delete().eq('id', id);
      if (scope.companyId) query = query.eq('company_id', scope.companyId);
      if (scope.requesterId) query = query.eq('user_id', scope.requesterId);
      if (scope.status) query = query.eq('status', scope.status);
      if (scope.requisitionName === null) query = query.is('requisition_name', null);
      const { error } = await query;
      if (error) throw new Error(error.message);
    },
    async notify(notification) {
      await sb.from('notifications').insert(notification);
    },
    async company(companyId) {
      const { data, error } = await sb.from('companies')
        .select('id,status')
        .eq('id', companyId)
        .single();
      return error ? null : data;
    },
    async markConverted(id, patch) {
      await sb.from('quotes').update(patch).eq('id', id);
    },
    async convertedQuote(id) {
      const { data } = await sb.from('quotes')
        .select('email,deal_value,product,company,type')
        .eq('id', id)
        .maybeSingle();
      return data || null;
    },
    orderRecipients(companyId) {
      return companyEmails(sb, companyId, 'orders');
    },
  };
}

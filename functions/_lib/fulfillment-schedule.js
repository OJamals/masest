// When MASEST actually hands a parcel to the carrier.
//
// ShipEngine quotes transit from the ship date, and defaults that to today when the request
// omits it. Asking without a ship_date therefore prices a parcel that does not exist yet:
// a Thursday-afternoon order came back "arrives Friday" because the estimate assumed the
// label already existed and the box was on the dock.
//
// So the correction belongs in the question, not in the answer. We compute the real
// dispatch date and send it; the carrier then applies its own service calendar — including
// the public holidays that a naive business-day loop silently gets wrong every November.
export const FULFILLMENT_POLICY = Object.freeze({
  // Warehouse is on Florida's Space Coast, so the cutoff is Eastern.
  cutoffHourEt: 14,
  // Pick, pack, and label a chemical order.
  handlingDays: 1,
});

function easternHour(now) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(now);
  return Number(hour) % 24;
}

// Eastern calendar date parts for an instant — the warehouse's "today", not UTC's.
function easternParts(now) {
  const [month, day, year] = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('/').map(Number);
  return { year, month, day };
}

export function isBusinessDay(date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

// The date the carrier can collect: today when the order beats the cutoff and the warehouse
// is open, otherwise forward to the next working day, then add the handling days.
export function dispatchDate(now = new Date(), policy = FULFILLMENT_POLICY) {
  const { year, month, day } = easternParts(now);
  const date = new Date(Date.UTC(year, month - 1, day));
  const handling = Math.max(0, Math.floor(Number(policy.handlingDays) || 0));
  const cutoff = Number(policy.cutoffHourEt);
  // Past the cutoff, today can no longer be used for picking.
  let remaining = handling + (Number.isFinite(cutoff) && easternHour(now) >= cutoff ? 1 : 0);
  if (remaining === 0) {
    // Same-day dispatch is only real if the warehouse is actually open.
    while (!isBusinessDay(date)) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isBusinessDay(date)) remaining -= 1;
  }
  return date;
}

// ShipEngine wants a plain calendar date.
export function shipDateString(now = new Date(), policy = FULFILLMENT_POLICY) {
  return dispatchDate(now, policy).toISOString().slice(0, 10);
}

// Handed to the browser so the note under the rate list is generated from the same policy
// the dates were calculated with, instead of hand-written copy that drifts.
export function fulfillmentSummary(now = new Date(), policy = FULFILLMENT_POLICY) {
  return {
    ship_date: shipDateString(now, policy),
    handling_days: Math.max(0, Math.floor(Number(policy.handlingDays) || 0)),
    cutoff_hour_et: Number(policy.cutoffHourEt) || 0,
  };
}

// Carton consolidation shared by checkout rating and fulfillment label purchase.
//
// Both sides MUST derive parcels the same way. When checkout rates two consolidated
// 50 lb cartons and fulfillment buys four individual parcels, the buyer is charged for a
// shipment MASEST never bought — the difference is pure margin loss, and multi-package
// service eligibility differs between the two shapes so the paid service may not even be
// purchasable. This module is the single implementation; `checkout-shipping.js` re-exports
// it for its existing callers and `shipstation-orders.js` imports it for label rating.
import { ShipStationError, normalizePackages } from './shipstation.js';

export const MAX_CHECKOUT_CARTON_WEIGHT_LB = 50;

export function roundMeasure(value) {
  return Math.round(value * 100) / 100;
}

// Lay the units out in `rowCount` rows and keep the arrangement with the smallest
// length + girth, which is what carriers price dimensional weight on.
export function packedDimensions(items) {
  let best;
  for (let rowCount = 1; rowCount <= items.length; rowCount += 1) {
    const rows = Array.from({ length: rowCount }, () => ({ length: 0, width: 0 }));
    for (const item of items) {
      const length = Math.max(item.length, item.width);
      const width = Math.min(item.length, item.width);
      const row = rows.reduce((shortest, candidate) => (
        candidate.length < shortest.length ? candidate : shortest
      ));
      row.length += length;
      row.width = Math.max(row.width, width);
    }
    const footprint = {
      length: Math.max(...rows.map((row) => row.length)),
      width: rows.reduce((sum, row) => sum + row.width, 0),
    };
    const candidate = {
      length: Math.max(footprint.length, footprint.width),
      width: Math.min(footprint.length, footprint.width),
      height: Math.max(...items.map((item) => item.height)),
    };
    const lengthAndGirth = candidate.length + 2 * (candidate.width + candidate.height);
    if (!best || lengthAndGirth < best.lengthAndGirth) best = { ...candidate, lengthAndGirth };
  }
  return {
    length: roundMeasure(best.length),
    width: roundMeasure(best.width),
    height: roundMeasure(best.height),
    unit: 'inch',
  };
}

export function combinePackagesForRates(packages, maxWeightLb = MAX_CHECKOUT_CARTON_WEIGHT_LB) {
  const units = (Array.isArray(packages) ? packages : []).map((pkg) => ({
    weight: Number(pkg?.weight?.value ?? pkg?.weight),
    length: Number(pkg?.dimensions?.length ?? pkg?.length),
    width: Number(pkg?.dimensions?.width ?? pkg?.width),
    height: Number(pkg?.dimensions?.height ?? pkg?.height),
  }));
  if (!units.length) throw new ShipStationError('shipping_package_profile_missing');
  if (units.some((unit) => ![unit.weight, unit.length, unit.width, unit.height]
    .every((value) => Number.isFinite(value) && value > 0))) {
    throw new ShipStationError('shipping_package_profile_missing');
  }
  units.sort((a, b) => b.weight - a.weight
    || (b.length * b.width * b.height) - (a.length * a.width * a.height));
  const cartons = [];
  for (const unit of units) {
    let carton = cartons.find((candidate) => candidate.weight + unit.weight <= maxWeightLb);
    if (!carton) {
      carton = { weight: 0, items: [] };
      cartons.push(carton);
    }
    carton.weight += unit.weight;
    carton.items.push(unit);
  }
  return cartons.map((carton) => ({
    package_code: 'package',
    weight: { value: roundMeasure(carton.weight), unit: 'pound' },
    dimensions: packedDimensions(carton.items),
  }));
}

// A package plan persisted at rate time and replayed at label time. Runs the same
// validation the provider request builder runs, so a corrupt or hand-edited plan is
// rejected here rather than producing a silently different shipment.
export function normalizePackagePlan(value) {
  if (!Array.isArray(value) || !value.length) return null;
  try {
    return normalizePackages(value);
  } catch {
    return null;
  }
}

export const QUOTE_TASK_DETAILS = Object.freeze([
  { id: 'fCurrentChemical', name: 'current_chemical', label: 'Cleaner used now', limit: 240 },
  { id: 'fCurrentDilution', name: 'current_dilution', label: 'Current mix', limit: 160 },
  { id: 'fLaborPerTask', name: 'labor_per_task', label: 'People and time', limit: 160 },
  { id: 'fWaterPerTask', name: 'water_per_task', label: 'Water used', limit: 160 },
  { id: 'fDowntimePerTask', name: 'downtime_per_task', label: 'Time out of service', limit: 160 },
  { id: 'fDisposalPerTask', name: 'disposal_per_task', label: 'Cleanup and wash water', limit: 240 },
  { id: 'fAssetLife', name: 'asset_life', label: 'Maintenance schedule', limit: 240 },
  { id: 'fWastewaterRoute', name: 'wastewater_route', label: 'Wash water', limit: 1000 },
  { id: 'fReopeningCriteria', name: 'reopening_criteria', label: 'Ready-to-use check', limit: 1000 },
]);

export const QUOTE_TASK_DETAIL_INTENTS = Object.freeze(['quote', 'audit', 'sample']);

export const PRIVATE_LABEL_DETAILS = Object.freeze([
  { id: 'fPrivateApplication', name: 'private_label_application', label: 'Private-label application', limit: 800 },
  { id: 'fPrivateQuantity', name: 'private_label_quantity', label: 'Estimated private-label quantity', limit: 160 },
  { id: 'fPrivatePackaging', name: 'private_label_packaging', label: 'Packaging preference', limit: 160 },
  { id: 'fPrivateDestination', name: 'private_label_destination', label: 'Delivery location', limit: 240 },
]);

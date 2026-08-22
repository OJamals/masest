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

export const QUOTE_TASK_DETAILS = Object.freeze([
  { id: 'fCurrentChemical', name: 'current_chemical', label: 'Current chemical', limit: 240 },
  { id: 'fCurrentDilution', name: 'current_dilution', label: 'Current dilution', limit: 160 },
  { id: 'fLaborPerTask', name: 'labor_per_task', label: 'Labor per completed task', limit: 160 },
  { id: 'fWaterPerTask', name: 'water_per_task', label: 'Water per completed task', limit: 160 },
  { id: 'fDowntimePerTask', name: 'downtime_per_task', label: 'Downtime per completed task', limit: 160 },
  { id: 'fDisposalPerTask', name: 'disposal_per_task', label: 'Disposal per completed task', limit: 240 },
  { id: 'fAssetLife', name: 'asset_life', label: 'Asset life context', limit: 240 },
  { id: 'fWastewaterRoute', name: 'wastewater_route', label: 'Wastewater route', limit: 1000 },
  { id: 'fReopeningCriteria', name: 'reopening_criteria', label: 'Reopening / return-to-service criteria', limit: 1000 },
]);

export const QUOTE_TASK_DETAIL_INTENTS = Object.freeze(['quote', 'audit', 'sample']);

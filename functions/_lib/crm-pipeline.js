// Pure deal-pipeline helpers (slice 2): stage machine, probabilities, stage-patch
// builder, forecast summary. No I/O — functions/api/admin/quotes.js passes rows in,
// gets normalized data out. Mirrors functions/_lib/quote-convert.js.

export const PIPELINE_STAGES = ['new', 'qualified', 'sample_audit', 'proposal', 'won', 'lost'];

export const STAGE_LABELS = {
  new: 'New', qualified: 'Qualified', sample_audit: 'Sample / Audit',
  proposal: 'Proposal', won: 'Won', lost: 'Lost',
};

// Weighted-forecast probability per stage (v1 fixed constants).
export const STAGE_PROBABILITY = { new: 0.1, qualified: 0.3, sample_audit: 0.5, proposal: 0.7, won: 1, lost: 0 };

export const LOST_REASONS = ['price', 'competitor', 'spec', 'timing', 'no_decision', 'other'];

export function validStage(stage) { return PIPELINE_STAGES.includes(String(stage)); }
export function isTerminal(stage) { return stage === 'won' || stage === 'lost'; }

// Build the quotes patch for a stage move. `now` injected for deterministic tests.
// Terminal stages also close the quote; lost captures a reason (free text, capped).
export function stagePatch({ stage, lost_reason, actor } = {}, now) {
  if (!validStage(stage)) return { error: 'invalid_stage' };
  const ts = (now || new Date()).toISOString();
  const patch = { pipeline_stage: stage, stage_changed_at: ts };
  if (isTerminal(stage)) {
    patch.status = 'closed';
    patch.handled_at = ts;
    if (actor) patch.handled_by = actor;
  }
  if (stage === 'lost') patch.lost_reason = String(lost_reason || '').trim().slice(0, 280) || 'other';
  return { patch };
}

// Forecast over quote rows. Null/zero deal_value rows are counted but excluded from $ math.
export function pipelineSummary(rows = []) {
  const stages = PIPELINE_STAGES.map((stage) => ({ stage, count: 0, value: 0 }));
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));
  let weighted = 0;
  let openValue = 0;
  for (const row of rows) {
    const stage = validStage(row.pipeline_stage) ? row.pipeline_stage : 'new';
    const bucket = byStage[stage];
    bucket.count += 1;
    const value = Number(row.deal_value);
    if (Number.isFinite(value) && value > 0) {
      bucket.value = +(bucket.value + value).toFixed(2);
      weighted = +(weighted + value * (STAGE_PROBABILITY[stage] || 0)).toFixed(2);
      if (stage !== 'lost' && stage !== 'won') openValue = +(openValue + value).toFixed(2);
    }
  }
  return { stages, weighted, open_value: openValue };
}

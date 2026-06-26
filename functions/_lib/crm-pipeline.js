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

// ---- Reporting aggregators (slice 3). Pure; quotes API computes over all non-spam rows. ----

// Active-funnel order (lost is terminal/off-funnel; won is the final reached step).
export const FUNNEL_STAGES = ['new', 'qualified', 'sample_audit', 'proposal', 'won'];

const dealValue = (row) => { const v = Number(row.deal_value); return Number.isFinite(v) && v > 0 ? v : 0; };
const sumValue = (rows) => +rows.reduce((s, r) => s + dealValue(r), 0).toFixed(2);

// Reached-count funnel from current state (no per-stage history). A non-lost deal at
// current stage index i counts as having reached every funnel step <= i; rate is the
// step-over-prior-step conversion.
export function conversionFunnel(rows = []) {
  const idxOf = (s) => FUNNEL_STAGES.indexOf(validStage(s) ? s : 'new');
  const active = rows.filter((r) => r.pipeline_stage !== 'lost');
  const reached = FUNNEL_STAGES.map((stage, k) => ({
    stage,
    reached: active.filter((r) => idxOf(r.pipeline_stage) >= k).length,
  }));
  return reached.map((row, k) => ({
    ...row,
    rate: k === 0 ? 1 : (reached[k - 1].reached ? +(row.reached / reached[k - 1].reached).toFixed(3) : 0),
  }));
}

// Open (non-terminal) deals with a value, grouped by expected-close month (YYYY-MM);
// missing close dates bucket to 'unscheduled' which always sorts last.
export function forecastByMonth(rows = []) {
  const open = rows.filter((r) => !isTerminal(r.pipeline_stage) && dealValue(r) > 0);
  const map = new Map();
  for (const r of open) {
    const key = r.expected_close ? String(r.expected_close).slice(0, 7) : 'unscheduled';
    const cur = map.get(key) || { month: key, value: 0, weighted: 0, count: 0 };
    cur.value = +(cur.value + dealValue(r)).toFixed(2);
    cur.weighted = +(cur.weighted + dealValue(r) * (STAGE_PROBABILITY[r.pipeline_stage] || 0)).toFixed(2);
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => {
    if (a.month === 'unscheduled') return 1;
    if (b.month === 'unscheduled') return -1;
    return a.month < b.month ? -1 : 1;
  });
}

export function lossReasonBreakdown(rows = []) {
  const map = new Map();
  for (const r of rows.filter((x) => x.pipeline_stage === 'lost')) {
    const key = r.lost_reason || 'other';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export function pipelineKpis(rows = []) {
  const won = rows.filter((r) => r.pipeline_stage === 'won');
  const lost = rows.filter((r) => r.pipeline_stage === 'lost');
  const open = rows.filter((r) => !isTerminal(r.pipeline_stage));
  const valued = rows.filter((r) => dealValue(r) > 0);
  const closed = won.length + lost.length;
  return {
    open_count: open.length,
    open_value: sumValue(open),
    weighted: pipelineSummary(rows).weighted,
    won_count: won.length,
    won_value: sumValue(won),
    lost_count: lost.length,
    win_rate: closed ? +(won.length / closed).toFixed(3) : 0,
    avg_deal: valued.length ? +(sumValue(valued) / valued.length).toFixed(2) : 0,
  };
}

export function pipelineReport(rows = []) {
  return {
    kpis: pipelineKpis(rows),
    funnel: conversionFunnel(rows),
    forecast_months: forecastByMonth(rows),
    loss_reasons: lossReasonBreakdown(rows),
  };
}

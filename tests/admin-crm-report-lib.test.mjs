import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversionFunnel, forecastByMonth, lossReasonBreakdown, pipelineKpis, pipelineReport,
} from '../functions/_lib/crm-pipeline.js';

const ROWS = [
  { pipeline_stage: 'new', deal_value: 1000, expected_close: '2026-07-10' },
  { pipeline_stage: 'qualified', deal_value: 2000, expected_close: '2026-07-20' },
  { pipeline_stage: 'proposal', deal_value: 4000, expected_close: '2026-08-05' },
  { pipeline_stage: 'proposal', deal_value: 1200, expected_close: null },
  { pipeline_stage: 'won', deal_value: 5000, expected_close: '2026-06-30' },
  { pipeline_stage: 'lost', deal_value: 3000, lost_reason: 'price' },
  { pipeline_stage: 'lost', deal_value: 1500, lost_reason: 'price' },
  { pipeline_stage: 'lost', deal_value: 800, lost_reason: 'competitor' },
];

test('conversionFunnel reports reached counts + step rates, excludes lost', () => {
  const f = conversionFunnel(ROWS);
  assert.deepEqual(f.map((x) => x.stage), ['new', 'qualified', 'sample_audit', 'proposal', 'won']);
  // active (non-lost) = 5 rows. reached(new)=5, qualified>=1 → 4, sample_audit>=2 → 3, proposal>=3 → 3, won>=4 → 1
  assert.equal(f[0].reached, 5);
  assert.equal(f[1].reached, 4);
  assert.equal(f[3].reached, 3);
  assert.equal(f[4].reached, 1);
  assert.equal(f[0].rate, 1);
  assert.equal(f[1].rate, +(4 / 5).toFixed(3));
});

test('forecastByMonth buckets open deals by close month, weighted', () => {
  const m = forecastByMonth(ROWS);
  const jul = m.find((x) => x.month === '2026-07');
  assert.equal(jul.value, 3000);                       // 1000 + 2000
  assert.equal(jul.weighted, +(1000 * 0.1 + 2000 * 0.3).toFixed(2)); // 700
  assert.ok(m.some((x) => x.month === 'unscheduled'));  // proposal w/ null close
  // won + lost excluded from forecast
  assert.ok(!m.some((x) => x.month === '2026-06'));
  // unscheduled sorts last
  assert.equal(m[m.length - 1].month, 'unscheduled');
});

test('lossReasonBreakdown counts lost reasons desc', () => {
  const l = lossReasonBreakdown(ROWS);
  assert.deepEqual(l[0], { reason: 'price', count: 2 });
  assert.equal(l.find((x) => x.reason === 'competitor').count, 1);
});

test('pipelineKpis win rate + averages', () => {
  const k = pipelineKpis(ROWS);
  assert.equal(k.won_count, 1);
  assert.equal(k.lost_count, 3);
  assert.equal(k.win_rate, +(1 / 4).toFixed(3));        // 1 won of 4 closed
  assert.equal(k.open_count, 4);                         // non-terminal: new, qualified, proposal x2
  assert.equal(k.open_value, 8200);                      // 1000 + 2000 + 4000 + 1200
  assert.equal(k.won_value, 5000);
});

test('pipelineReport bundles the four sections', () => {
  const r = pipelineReport(ROWS);
  assert.ok(r.kpis && r.funnel && r.forecast_months && r.loss_reasons);
  assert.equal(r.funnel.length, 5);
});

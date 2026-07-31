import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, DEFAULT_WEIGHTS } from '../shared/revenue-planner.mjs';

const base = {
  targetRevenue: 100_000_000,
  mktRatio: 0.4,
  aov: 15_000_000,
  sqlPerLead: 0.3,
  orderPerSql: 0.5
};

const clone = (v) => structuredClone(v);

test('edited weights that keep 100% carry through with no total warning', () => {
  const weights = clone(DEFAULT_WEIGHTS);
  weights.tier1 = { core: 0.6, brand: 0.4 }; // still sums to 1
  const plan = computePlan(base, weights);
  assert.equal(plan.weights.tier1.core, 0.6);
  assert.equal(plan.allocation.tier1.core.amount, plan.mktBudget * 0.6);
  assert.ok(!plan.warnings.some((w) => w.code === 'WEIGHT_TOTAL' && w.field === 'tier1'));
});

test('edited weights whose group total != 100% raise a WEIGHT_TOTAL warning', () => {
  const weights = clone(DEFAULT_WEIGHTS);
  weights.tier1 = { core: 0.6, brand: 0.6 }; // sums to 1.2 → unreasonable
  const plan = computePlan(base, weights);
  const warning = plan.warnings.find((w) => w.code === 'WEIGHT_TOTAL' && w.field === 'tier1');
  assert.ok(warning, 'expected a tier1 total warning');
  assert.match(warning.message, /120\.0%/);
});

test('out-of-range weight value raises a WEIGHT_VALUE warning', () => {
  const weights = clone(DEFAULT_WEIGHTS);
  weights.channels = { ...weights.channels, metaAds: 1.5 };
  const plan = computePlan(base, weights);
  assert.ok(plan.warnings.some((w) => w.code === 'WEIGHT_VALUE' && w.field === 'channels'));
});

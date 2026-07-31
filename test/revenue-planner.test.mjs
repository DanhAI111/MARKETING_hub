import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEIGHTS,
  allocateBudget,
  computeFunnel,
  computePlan,
  spreadMonthly,
  suggestWeightsHeuristic,
  validateInputs,
  validateWeights
} from '../shared/revenue-planner.mjs';

const baseInputs = Object.freeze({
  targetRevenue: 1_500_000_000,
  mktRatio: 0.4,
  aov: 15_000_000,
  sqlPerLead: 0.3,
  orderPerSql: 0.5,
  monthlyMoM: 0.05
});

const sumAmounts = (nodes) => Object.values(nodes)
  .reduce((total, node) => total + node.amount, 0);

test('computeFunnel calculates revenue, budget and reverse funnel from a direct target', () => {
  const result = computeFunnel(baseInputs);

  assert.equal(result.targetRevenue, 1_500_000_000);
  assert.equal(result.mktBudget, 600_000_000);
  assert.equal(result.customers, 100);
  assert.equal(result.sql, 200);
  assert.ok(Math.abs(result.leads - 666.6666666666667) < 1e-9);
  assert.equal(result.customerBudget, 480_000_000);
  assert.equal(result.cps, 4_800_000);
});

test('computeFunnel derives target revenue from previous revenue and growth multiplier', () => {
  const result = computeFunnel({
    ...baseInputs,
    targetRevenue: undefined,
    prevRevenue: 1_365_000_000,
    growth: 1.1
  });

  assert.ok(Math.abs(result.targetRevenue - 1_501_500_000) < 1e-6);
});

test('allocateBudget keeps every complete allocation tier equal to the marketing budget', () => {
  const budget = 600_000_000;
  const allocation = allocateBudget(budget, DEFAULT_WEIGHTS);

  assert.equal(sumAmounts(allocation.tier1), budget);
  assert.equal(sumAmounts(allocation.tier2), budget);
  assert.equal(sumAmounts(allocation.tier3), budget);
  assert.equal(sumAmounts(allocation.tier4), budget);
  assert.equal(allocation.tier4.seoSocial.amount, budget * 0.2);
  assert.equal(allocation.tier4.abm.group, 'newStrategy');
  assert.equal(allocation.tier4.chatbot.group, 'experiment');
});

test('spreadMonthly normalizes compound growth while preserving both annual totals', () => {
  const budget = 600_000_000;
  const revenue = 1_500_000_000;
  const monthly = spreadMonthly(budget, revenue, 0.05);

  assert.equal(monthly.length, 12);
  assert.equal(monthly[0].month, 1);
  assert.ok(Math.abs(monthly.reduce((sum, row) => sum + row.budget, 0) - budget) < 1e-6);
  assert.ok(Math.abs(monthly.reduce((sum, row) => sum + row.revenueTarget, 0) - revenue) < 1e-6);
  assert.ok(Math.abs(monthly[1].budget / monthly[0].budget - 1.05) < 1e-12);
});

test('computePlan is immutable and applies custom weights without mutating defaults', () => {
  const defaultsSnapshot = structuredClone(DEFAULT_WEIGHTS);
  const customWeights = {
    ...structuredClone(DEFAULT_WEIGHTS),
    tier1: { core: 0.75, brand: 0.25 }
  };

  const plan = computePlan(baseInputs, customWeights);

  assert.equal(plan.allocation.tier1.core.amount, plan.mktBudget * 0.75);
  assert.deepEqual(DEFAULT_WEIGHTS, defaultsSnapshot);
  assert.ok(Object.isFrozen(plan));
});

test('validateInputs rejects missing and out-of-bound business inputs', () => {
  const result = validateInputs({
    targetRevenue: 0,
    mktRatio: 1,
    aov: -1,
    sqlPerLead: 0,
    orderPerSql: 1.1
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('doanh thu')));
  assert.ok(result.errors.some((message) => message.includes('AOV')));
  assert.ok(result.errors.some((message) => message.includes('marketing')));
  assert.ok(result.errors.some((message) => message.includes('SQL/Lead')));
  assert.ok(result.errors.some((message) => message.includes('Đơn hàng/SQL')));
  assert.throws(() => computePlan({ ...baseInputs, aov: 0 }), /AOV/);
  assert.equal(validateInputs(null).valid, false);
  assert.equal(validateInputs({ ...baseInputs, prevRevenue: -1 }).valid, false);
});

test('validateWeights and computePlan expose allocation and business warnings', () => {
  const invalidWeights = {
    ...structuredClone(DEFAULT_WEIGHTS),
    tier2: { core: 0.8, newStrategy: 0.3, experiment: 0.1 },
    tier1: { core: 1.5, brand: 0.2 }
  };

  const weightWarnings = validateWeights(invalidWeights);
  const plan = computePlan({ ...baseInputs, mktRatio: 0.8 }, invalidWeights);

  assert.ok(weightWarnings.some((warning) => warning.code === 'WEIGHT_TOTAL'));
  assert.ok(plan.warnings.some((warning) => warning.code === 'HIGH_MARKETING_RATIO'));
  assert.ok(plan.warnings.some((warning) => warning.code === 'CPS_ABOVE_AOV'));
});

test('suggestWeightsHeuristic returns a complete normalized fallback with explanations', () => {
  const suggestion = suggestWeightsHeuristic({ ...baseInputs, industry: 'B2B SaaS' });

  assert.equal(suggestion.source, 'fallback');
  assert.ok(suggestion.reasons.length >= 3);
  assert.deepEqual(validateWeights(suggestion.weights), []);
  assert.notStrictEqual(suggestion.weights, DEFAULT_WEIGHTS);
});

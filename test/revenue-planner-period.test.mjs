import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, PERIOD_MONTHS } from '../shared/revenue-planner.mjs';

const base = {
  targetRevenue: 100_000_000,
  mktRatio: 0.4,
  aov: 15_000_000,
  sqlPerLead: 0.3,
  orderPerSql: 0.5,
  monthlyMoM: 0.05
};

test('period maps to the right number of monthly rows', () => {
  assert.equal(computePlan({ ...base, period: 'month' }).monthly.length, PERIOD_MONTHS.month);
  assert.equal(computePlan({ ...base, period: 'quarter' }).monthly.length, PERIOD_MONTHS.quarter);
  assert.equal(computePlan({ ...base, period: 'year' }).monthly.length, PERIOD_MONTHS.year);
});

test('input revenue is the total for the chosen period (funnel unchanged by period)', () => {
  const month = computePlan({ ...base, period: 'month' });
  const year = computePlan({ ...base, period: 'year' });
  // Same input number ⇒ same budget/funnel; only the spread granularity differs.
  assert.equal(month.mktBudget, year.mktBudget);
  assert.equal(month.funnel.customers, year.funnel.customers);
});

test('monthly rows always sum back to the period budget and revenue', () => {
  for (const period of ['month', 'quarter', 'year']) {
    const plan = computePlan({ ...base, period });
    const sumBudget = plan.monthly.reduce((s, r) => s + r.budget, 0);
    const sumRevenue = plan.monthly.reduce((s, r) => s + r.revenueTarget, 0);
    assert.ok(Math.abs(sumBudget - plan.mktBudget) < 1e-3, `${period} budget sum`);
    assert.ok(Math.abs(sumRevenue - plan.targetRevenue) < 1e-3, `${period} revenue sum`);
  }
});

test('missing period defaults to year (backward compatible)', () => {
  const plan = computePlan(base);
  assert.equal(plan.period, 'year');
  assert.equal(plan.monthly.length, 12);
});

test('invalid period is rejected', () => {
  assert.throws(() => computePlan({ ...base, period: 'week' }), /Kỳ tính/);
});

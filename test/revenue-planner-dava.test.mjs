import assert from 'node:assert/strict';
import test from 'node:test';

import { computePlan } from '../shared/revenue-planner.mjs';

// Guards the exact DAVA reference numbers end-to-end through computePlan (derived
// target path + custom months). Float tolerance because targetRevenue = prev*growth
// carries binary rounding (1_365_000_000 * 1.1 = 1_501_500_000.0000002).
const TOL = 1e-3;
const near = (actual, expected) => Math.abs(actual - expected) <= TOL;

test('computePlan reproduces the DAVA reference funnel from prevRevenue and growth', () => {
  const plan = computePlan({
    prevRevenue: 1_365_000_000,
    growth: 1.1,
    mktRatio: 0.4,
    aov: 15_000_000,
    sqlPerLead: 0.3,
    orderPerSql: 0.5,
    monthlyMoM: 0.05,
    months: 3
  });
  const f = plan.funnel;

  assert.ok(near(f.targetRevenue, 1_501_500_000), `targetRevenue ${f.targetRevenue}`);
  assert.ok(near(f.mktBudget, 600_600_000), `mktBudget ${f.mktBudget}`);
  assert.ok(near(f.customers, 100.1), `customers ${f.customers}`);
  assert.ok(near(f.sql, 200.2), `sql ${f.sql}`);
  assert.ok(near(f.leads, 667.3333333333), `leads ${f.leads}`);
  assert.ok(near(f.customerBudget, 480_480_000), `customerBudget ${f.customerBudget}`);
  assert.ok(near(f.cps, 4_800_000), `cps ${f.cps}`);

  // months honored; monthly totals stay consistent with the funnel figures.
  assert.equal(plan.monthly.length, 3);
  const budgetSum = plan.monthly.reduce((s, r) => s + r.budget, 0);
  const revenueSum = plan.monthly.reduce((s, r) => s + r.revenueTarget, 0);
  assert.ok(near(budgetSum, f.mktBudget), `budgetSum ${budgetSum}`);
  assert.ok(near(revenueSum, f.targetRevenue), `revenueSum ${revenueSum}`);
});

test('DAVA allocation weights each sum to 1.0 across every tier', () => {
  const plan = computePlan({
    prevRevenue: 1_365_000_000,
    growth: 1.1,
    mktRatio: 0.4,
    aov: 15_000_000,
    sqlPerLead: 0.3,
    orderPerSql: 0.5
  });
  const { mktBudget } = plan;

  for (const tier of ['tier1', 'tier2', 'tier3', 'tier4', 'channels', 'content']) {
    const nodes = plan.allocation[tier];
    const ratioSum = Object.values(nodes).reduce((s, n) => s + n.ratio, 0);
    const amountSum = Object.values(nodes).reduce((s, n) => s + n.amount, 0);
    assert.ok(near(ratioSum, 1), `${tier} ratio sum ${ratioSum}`);
    assert.ok(near(amountSum, mktBudget), `${tier} amount sum ${amountSum}`);
  }
});

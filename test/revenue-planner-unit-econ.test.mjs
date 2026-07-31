import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, computePlan } from '../shared/revenue-planner.mjs';

const base = {
  targetRevenue: 100_000_000,
  mktRatio: 0.4,
  aov: 10_000_000,
  sqlPerLead: 0.3,
  orderPerSql: 0.5
};

test('LTV uses gross margin, frequency and retention', () => {
  // margin/customer = aov 10M × freq 2 × margin 0.5 = 10M; retention 0.5 ⇒ ltv = 10M / 0.5 = 20M
  const funnel = computeFunnel({ ...base, grossMargin: 0.5, purchaseFrequency: 2, retentionRate: 0.5 });
  assert.equal(funnel.ltv, 20_000_000);
});

test('CAC = customer budget / customers, and ratio = ltv / cac', () => {
  const funnel = computeFunnel({ ...base, grossMargin: 0.5 });
  assert.equal(funnel.cac, funnel.customerBudget / funnel.customers);
  assert.equal(funnel.ltvCacRatio, funnel.ltv / funnel.cac);
  assert.equal(funnel.cps, funnel.cac); // cps kept as alias for backward compat
});

test('payback = cac / margin-per-customer', () => {
  const funnel = computeFunnel({ ...base, grossMargin: 0.5, purchaseFrequency: 1 });
  assert.ok(Math.abs(funnel.paybackPeriods - funnel.cac / (base.aov * 0.5)) < 1e-6);
});

test('low LTV:CAC raises LTV_CAC_LOW; healthy does not', () => {
  // thin margin ⇒ low ltv ⇒ ratio < 3
  const bad = computePlan({ ...base, grossMargin: 0.1 });
  assert.ok(bad.warnings.some((w) => w.code === 'LTV_CAC_LOW'));
  // fat margin + repeat + retention ⇒ ratio ≥ 3
  const good = computePlan({ ...base, grossMargin: 0.8, purchaseFrequency: 3, retentionRate: 0.6 });
  assert.ok(!good.warnings.some((w) => w.code === 'LTV_CAC_LOW'));
});

test('gross margin below marketing ratio raises MARGIN_BELOW_MKT', () => {
  const plan = computePlan({ ...base, mktRatio: 0.4, grossMargin: 0.3 });
  assert.ok(plan.warnings.some((w) => w.code === 'MARGIN_BELOW_MKT'));
});

test('backward compatible: no gross margin ⇒ no unit-econ warnings, ltv defaults to full revenue basis', () => {
  const funnel = computeFunnel(base);
  assert.equal(funnel.grossMargin, 1); // default: no margin given
  assert.equal(funnel.ltv, base.aov); // freq 1, retention 0, margin 1
  const plan = computePlan(base);
  assert.ok(!plan.warnings.some((w) => w.code === 'LTV_CAC_LOW' || w.code === 'MARGIN_BELOW_MKT'));
});

test('invalid gross margin / frequency rejected', () => {
  assert.throws(() => computeFunnel({ ...base, grossMargin: 1.5 }), /Biên lợi nhuận/);
  assert.throws(() => computeFunnel({ ...base, purchaseFrequency: 0 }), /Số đơn/);
});

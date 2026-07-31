import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_WEIGHTS, validateWeights } from '../shared/revenue-planner.mjs';
import { suggestAllocation } from '../shared/ai-allocation.mjs';

const inputs = Object.freeze({
  targetRevenue: 1_500_000_000,
  mktRatio: 0.4,
  aov: 15_000_000,
  sqlPerLead: 0.3,
  orderPerSql: 0.5,
  industry: 'B2B SaaS'
});

test('suggestAllocation uses the normalized heuristic without calling fetch when key is missing', async () => {
  const result = await suggestAllocation({
    inputs,
    apiKey: '',
    fetchImpl: () => {
      throw new Error('fetch must not run');
    }
  });

  assert.equal(result.source, 'fallback');
  assert.ok(result.reasons.length >= 3);
  assert.deepEqual(validateWeights(result.weights), []);
});

test('suggestAllocation parses a strict AI JSON response and merges known overrides', async () => {
  const result = await suggestAllocation({
    inputs,
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'test-model');
      assert.equal(options.headers['anthropic-version'], '2023-06-01');
      return new Response(JSON.stringify({
        content: [{
          type: 'text',
          text: JSON.stringify({
            weights: {
              tier1: { core: 0.75, brand: 0.25, unknown: 1 }
            },
            reasons: ['Tăng đầu tư thương hiệu để hỗ trợ mục tiêu dài hạn.'],
            ignored: 'field'
          })
        }]
      }), { status: 200 });
    }
  });

  assert.equal(result.source, 'ai');
  assert.equal(result.weights.tier1.core, 0.75);
  assert.equal(result.weights.tier1.brand, 0.25);
  assert.equal(result.weights.tier1.unknown, undefined);
  assert.deepEqual(result.weights.tier2, DEFAULT_WEIGHTS.tier2);
  assert.deepEqual(result.warnings, []);
});

test('suggestAllocation reports an AI failure through onError and returns a visible fallback warning', async () => {
  let reportedError = null;
  const result = await suggestAllocation({
    inputs,
    apiKey: 'test-key',
    fetchImpl: async () => new Response('upstream failed', { status: 503 }),
    onError: (error) => {
      reportedError = error;
    }
  });

  assert.equal(result.source, 'fallback');
  assert.match(reportedError.message, /503/);
  assert.ok(result.warnings.some((warning) => warning.code === 'AI_UNAVAILABLE'));
});

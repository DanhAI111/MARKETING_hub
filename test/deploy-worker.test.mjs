import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildWranglerArgs, resolveBuildSha } = require('../scripts/deploy-worker.cjs');

test('deploy wrapper injects an auditable Git SHA while preserving caller arguments', () => {
  assert.deepEqual(
    buildWranglerArgs('abc123def456', ['--dry-run', '--keep-vars']),
    [
      'deploy',
      '--var',
      'BUILD_SHA:abc123def456',
      '--message',
      'Marketing Hub abc123def456',
      '--dry-run',
      '--keep-vars'
    ]
  );
});

test('deploy wrapper accepts only a non-empty hexadecimal commit identity', () => {
  assert.equal(resolveBuildSha({ BUILD_SHA: 'A1B2C3D4' }, () => ''), 'a1b2c3d4');
  assert.equal(resolveBuildSha({}, () => 'deadbeef\n'), 'deadbeef');
  assert.throws(() => resolveBuildSha({ BUILD_SHA: 'not a sha' }, () => ''), /Git SHA/i);
  assert.throws(() => resolveBuildSha({}, () => ''), /Git SHA/i);
});

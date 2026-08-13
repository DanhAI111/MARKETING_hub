const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const resolveBuildSha = (env = process.env, readGitSha = () => execFileSync(
  'git',
  ['rev-parse', '--short=12', 'HEAD'],
  { encoding: 'utf8' }
)) => {
  const sha = String(env.BUILD_SHA || readGitSha() || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error('Không thể xác định Git SHA hợp lệ cho bản deploy.');
  }
  return sha;
};

const buildWranglerArgs = (buildSha, extraArgs = []) => [
  'deploy',
  '--var',
  `BUILD_SHA:${buildSha}`,
  '--message',
  `Marketing Hub ${buildSha}`,
  ...extraArgs
];

const run = () => {
  const buildSha = resolveBuildSha();
  const wranglerPackage = require.resolve('wrangler/package.json');
  const wranglerBin = path.join(path.dirname(wranglerPackage), 'bin', 'wrangler.js');
  const result = spawnSync(
    process.execPath,
    [wranglerBin, ...buildWranglerArgs(buildSha, process.argv.slice(2))],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`Wrangler dừng bởi signal ${result.signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
};

if (require.main === module) run();

module.exports = { buildWranglerArgs, resolveBuildSha };

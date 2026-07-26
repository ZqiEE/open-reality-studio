#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp-rlsok-cli');

if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
try {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
      '--outDir',
      output,
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--noEmit',
      'false'
    ],
    { cwd: root, stdio: 'inherit' }
  );
  const result = spawnSync(
    process.execPath,
    [path.join(output, 'apps', 'cli', 'rlsok.js'), ...process.argv.slice(2)],
    { cwd: root, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 2;
} finally {
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
}

#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, '.tmp-rlsok-'));
const isTest = process.argv[2] === '--test';
const sourceEntry = isTest ? process.argv[3] : 'apps/cli/rlsok.ts';
if (!sourceEntry || path.extname(sourceEntry) !== '.ts') {
  throw new Error('test runner requires a TypeScript entry path');
}
const runtimeArgs = isTest ? process.argv.slice(4) : process.argv.slice(2);
const compiledEntry = path.join(output, sourceEntry.replace(/\.ts$/, '.js'));

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
    [compiledEntry, ...runtimeArgs],
    { cwd: root, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 2;
} finally {
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
}

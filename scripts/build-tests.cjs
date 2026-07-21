#!/usr/bin/env node
/**
 * build-tests.cjs — compile the whole TypeScript project ONCE into a shared
 * output directory that every `test:*` suite can reuse.
 *
 * WHY: today each `test:<name>` script runs its own
 *   `tsc -p tsconfig.json --outDir .tmp-<name> --noEmit false`
 * which recompiles the entire project from scratch. `npm run verify` chains
 * 30+ suites, so the same source is emitted a dozen-plus times — this is the
 * dominant cost of `verify` and the source of the `.tmp-*` directory sprawl.
 *
 * This script emits the project a single time to `.tmp-tests/`. Run it once,
 * then execute any compiled suite directly:
 *   node scripts/build-tests.cjs
 *   node .tmp-tests/tests/real-hardware/realHardware.test.js
 *   node .tmp-tests/tests/servo-intent/servoIntent.test.js
 *
 * SCOPE: this is a build/tooling helper only. It changes nothing about the
 * safety gate, execution path, audit semantics, or any test's assertions —
 * the same compiled JavaScript runs, just emitted once instead of N times.
 *
 * The existing per-suite `test:*` scripts are left untouched so nothing breaks;
 * adopt this incrementally (e.g. a `test:fast` that reuses `.tmp-tests/`).
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.tmp-tests');
const TS_CONFIG = path.join(ROOT, 'tsconfig.json');

function log(msg) {
  process.stdout.write(`[build-tests] ${msg}\n`);
}

function main() {
  const started = Date.now();

  if (fs.existsSync(OUT_DIR)) {
    log(`cleaning previous ${path.relative(ROOT, OUT_DIR)}/`);
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }

  log('compiling project once (tsc -> .tmp-tests/) ...');
  // Mirror the exact compile the per-suite scripts already use, so emitted
  // output is byte-for-byte equivalent — just produced a single time.
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p', TS_CONFIG,
      '--outDir', OUT_DIR,
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--noEmit', 'false'
    ],
    { stdio: 'inherit', cwd: ROOT }
  );

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log(`done in ${secs}s. Shared output ready at ${path.relative(ROOT, OUT_DIR)}/`);
  log('run a suite with, e.g.: node .tmp-tests/tests/real-hardware/realHardware.test.js');
}

try {
  main();
} catch (err) {
  process.stderr.write(`[build-tests] FAILED: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
}

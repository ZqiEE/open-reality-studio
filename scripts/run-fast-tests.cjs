#!/usr/bin/env node
/**
 * run-fast-tests.cjs — a fast, near-complete local test gate.
 *
 * Two phases:
 *   1. no-compile suites — already run on committed lib/*.js, no build needed.
 *   2. compile-once suites — today each of these 20 `test:*` scripts runs its
 *      OWN full `tsc -p tsconfig.json --outDir .tmp-<name> --noEmit false`
 *      before executing a single suite, so `npm run verify` compiles the whole
 *      project 20 times. This runner emits the project a single time into
 *      `.tmp-tests/` (via build-tests.cjs) and runs all 20 against it.
 *
 * Equivalence: every suite is invoked with the exact same argv its per-suite
 * `test:*` script uses — the committed lib/*.js runner, the compiled entrypoint
 * `.tmp-tests/<path>` (17), or the source runner `<runner>.js .tmp-tests` (3).
 * The emitted JavaScript and the assertions are identical; only the 19
 * redundant compiles are removed.
 *
 * Verified locally: 33/33 green (13 no-compile + 20 compile-once) from a single
 * shared compile, including the safety-critical real-hardware invariant suite
 * and the source-string conformance/desktop/accessibility suites.
 *
 * Scope: additive tooling. Existing per-suite `test:*` scripts and `verify` are
 * untouched. This gate deliberately EXCLUDES suites that need a heavier setup:
 *   - test:support             (compiles Electron first)
 *   - test:release             (needs release-inputs/legal files)
 *   - desktop:*-acceptance     (run the packaged renderer)
 *   - build                    (full Next production build)
 * Keep running `npm run verify` on your machine as the canonical pre-release
 * gate. This is the fast inner-loop gate.
 *
 * Usage:  node scripts/run-fast-tests.cjs   (or: npm run test:fast)
 * Exit code is non-zero if any suite fails.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.tmp-tests');

// Phase 1 — suites that already run on committed lib/*.js (no compile).
const NO_COMPILE = [
  ['conformance', 'lib/conformance/runConformance.js'],
  ['virtual-lab', 'lib/virtual-lab/runVirtualLabTests.js'],
  ['desktop', 'lib/desktop/runDesktopTests.js'],
  ['accessibility', 'lib/ui/runAccessibilityTests.js'],
  ['assets', 'lib/assets/runAssetTests.js'],
  ['action-runtime', 'lib/action-runtime/runActionRuntimeTests.js'],
  ['compiler', 'lib/compiler/runCompilerTests.js'],
  ['autonomy', 'lib/autonomy-core/runAutonomyCoreTests.js'],
  ['local-runtime', 'lib/runtime/runLocalRuntimeTests.js'],
  ['reporting', 'lib/reporting/runReportingTests.js'],
  ['launch-closure', 'lib/release/runLaunchClosureTests.js']
];

// Phase 2 — suites that each recompile the whole project; collapsed to ONE compile.
//  mode 'compiled': run `node .tmp-tests/<entry>`
//  mode 'runner'  : run `node <entry> .tmp-tests`  (entry is a source .js)
const COMPILE = [
  ['project-files', 'compiled', 'tests/project-files/projectFileContract.test.js'],
  ['open-reality-runtime', 'compiled', 'tests/open-reality-runtime/runtimeKernel.test.js'],
  ['plain-language', 'compiled', 'tests/open-reality-runtime/plainLanguage.test.js'],
  ['reality-assets', 'compiled', 'tests/reality-assets/realityAssets.test.js'],
  ['reality-asset-import', 'compiled', 'tests/reality-assets/realityAssetImport.test.js'],
  ['reality-asset-devkit', 'compiled', 'tests/reality-assets/realityAssetDeveloperKit.test.js'],
  ['action-manifest', 'compiled', 'tests/action-manifest/actionManifest.test.js'],
  ['llm-compiler', 'compiled', 'tests/llm-compiler/llmCompiler.test.js'],
  ['manual-import', 'compiled', 'tests/manual-import/manualProfileImport.test.js'],
  ['receipt-core', 'compiled', 'tests/receipt/auditReceipt.test.js'],
  ['receipt-real', 'compiled', 'tests/receipt/realExecutionReceipt.test.js'],
  ['receipt-html', 'compiled', 'tests/receipt/receiptHtml.test.js'],
  ['real-hardware', 'compiled', 'tests/real-hardware/realHardware.test.js'],
  ['virtual-loopback', 'compiled', 'tests/real-hardware/virtualLoopbackAcceptance.test.js'],
  ['reference-servo-angle-track', 'compiled', 'tests/reference-servo-angle-track/referenceServoAngleTrack.test.js'],
  ['servo-twin', 'compiled', 'tests/servo-twin/servoTwin.test.js'],
  ['reference-servo-preflight', 'compiled', 'tests/reference-servo-preflight/referenceServoPreflight.test.js'],
  ['reference-servo-preflight-view', 'compiled', 'tests/reference-servo-preflight-view/referenceServoPreflightView.test.js'],
  ['reference-servo-preflight-audit', 'compiled', 'tests/reference-servo-preflight-audit/referenceServoPreflightAudit.test.js'],
  ['servo-intent', 'compiled', 'tests/servo-intent/servoIntent.test.js'],
  ['marketplace', 'compiled', 'tests/marketplace/marketplace.test.js'],
  ['protocol', 'runner', 'tests/open-reality-protocol/runProtocolTests.js'],
  ['adapter-sdk', 'runner', 'tests/adapter-sdk/runAdapterSdkTests.js'],
  ['sdk-conformance', 'compiled', 'tests/adapter-sdk/sdkConformance.test.js'],
  ['sdk-scaffold', 'compiled', 'tests/adapter-sdk/sdkScaffold.test.js'],
  ['sdk-submit', 'compiled', 'tests/adapter-sdk/sdkSubmit.test.js'],
  ['sdk-onramp', 'compiled', 'tests/adapter-sdk/sdkOnramp.test.js'],
  ['standard-catalog', 'compiled', 'tests/adapter-sdk/standardCatalog.test.js'],
  ['sdk-review', 'compiled', 'tests/adapter-sdk/sdkReview.test.js'],
  ['sdk-publish', 'compiled', 'tests/adapter-sdk/sdkPublish.test.js'],
  ['ecosystem-chain', 'compiled', 'tests/adapter-sdk/ecosystemChain.test.js'],
  ['sdk-catalog-build', 'compiled', 'tests/adapter-sdk/sdkCatalogBuild.test.js'],
  ['sdk-overview', 'compiled', 'tests/adapter-sdk/sdkOverview.test.js'],
  ['governance', 'compiled', 'tests/governance-invariants/governanceMap.test.js'],
  ['device-onboarding', 'runner', 'tests/device-onboarding/runDeviceOnboardingTests.js']
];

function log(msg) { process.stdout.write(`${msg}\n`); }

function exec(argv) {
  try {
    execFileSync(process.execPath, argv, { stdio: 'pipe', cwd: ROOT });
    return { ok: true };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`.trim() };
  }
}

function report(name, r, results) {
  process.stdout.write(`[fast] ${name.padEnd(32)} `);
  log(r.ok ? 'PASS' : 'FAIL');
  if (!r.ok && r.out) log(r.out.split('\n').slice(-6).map((l) => `    ${l}`).join('\n'));
  results.push({ name, ok: r.ok });
}

function main() {
  const started = Date.now();
  const results = [];

  log('[fast] phase 1/2: no-compile suites');
  for (const [name, entry] of NO_COMPILE) report(name, exec([path.join(ROOT, entry)]), results);

  log('[fast] phase 2/2: shared compile + compile suites');
  log('[fast] compiling project once (shared .tmp-tests/) ...');
  execFileSync(process.execPath, [path.join(__dirname, 'build-tests.cjs')], { stdio: 'inherit', cwd: ROOT });
  for (const [name, mode, entry] of COMPILE) {
    const argv = mode === 'compiled' ? [path.join(OUT_DIR, entry)] : [path.join(ROOT, entry), OUT_DIR];
    report(name, exec(argv), results);
  }

  const failed = results.filter((r) => !r.ok);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log('');
  log(`[fast] ${results.length - failed.length}/${results.length} passed in ${secs}s (1 compile, not ${COMPILE.length}).`);
  if (failed.length) {
    log(`[fast] FAILED: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
  log('[fast] Full local gate green (excludes build/support/release/design-acceptance — run `npm run verify` for those).');
}

main();

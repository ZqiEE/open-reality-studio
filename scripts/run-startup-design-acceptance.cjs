'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const evidencePath = path.join(root, 'release', `RLSOK-${packageJson.version}-Startup-Acceptance.json`);
const electron = require('electron');
const environment = { ...process.env, ORS_STARTUP_DESIGN_EVIDENCE_PATH: evidencePath };
delete environment.ELECTRON_RUN_AS_NODE;

execFileSync(electron, [path.join(root, 'dist-electron', 'main.js'), '--prod', '--startup-design-smoke-test'], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
  timeout: 300_000,
  windowsHide: true
});

if (!fs.existsSync(evidencePath)) throw new Error(`Startup acceptance evidence missing: ${evidencePath}`);
if (!fs.existsSync(`${evidencePath}.sha256`)) throw new Error(`Startup acceptance evidence checksum missing: ${evidencePath}.sha256`);
console.log('Startup-design acceptance evidence written.');
console.log(`- Evidence: ${path.basename(evidencePath)}`);

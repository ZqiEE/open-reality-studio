const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { validateLegalReleaseInputs } = require('./legal-release-inputs.cjs');

const root = path.resolve(__dirname, '..');
const productionRelease = process.argv.includes('--production-release');

let builderCli;

try {
  require.resolve('electron-builder');
  builderCli = require.resolve('electron-builder/out/cli/cli.js');
} catch {
  console.error('electron-builder is not installed. Run npm install to fetch devDependencies before packaging the desktop installer.');
  process.exit(1);
}

const builderArguments = [builderCli, '--win', 'nsis'];
if (productionRelease) {
  const legal = validateLegalReleaseInputs(root);
  builderArguments.push(`--config.nsis.license=${legal.documents.eula.path}`);
}

execFileSync(process.execPath, builderArguments, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
});

execFileSync(process.execPath, [path.join(__dirname, 'verify-electron-package.cjs'), ...(productionRelease ? ['--production-release'] : [])], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
});

const packagedExecutable = path.join(root, 'release', 'win-unpacked', 'RLSOK.exe');
const smokeEnvironment = { ...process.env };
delete smokeEnvironment.ELECTRON_RUN_AS_NODE;
execFileSync(packagedExecutable, ['--prod', '--smoke-test'], {
  cwd: path.dirname(packagedExecutable),
  env: smokeEnvironment,
  stdio: 'inherit',
  timeout: 300_000,
  windowsHide: true
});

console.log('Packaged desktop first-run renderer smoke test passed.');

const packageJson = require(path.join(root, 'package.json'));
const startupEvidencePath = path.join(root, 'release', `RLSOK-${packageJson.version}-Startup-Acceptance.json`);
execFileSync(packagedExecutable, ['--prod', '--startup-design-smoke-test'], {
  cwd: path.dirname(packagedExecutable),
  env: { ...smokeEnvironment, ORS_STARTUP_DESIGN_EVIDENCE_PATH: startupEvidencePath },
  stdio: 'inherit',
  timeout: 300_000,
  windowsHide: true
});

console.log('Packaged desktop startup-design acceptance passed.');

const designEvidencePath = path.join(root, 'release', `RLSOK-${packageJson.version}-Design-Acceptance.json`);
execFileSync(packagedExecutable, ['--prod', '--design-smoke-test'], {
  cwd: path.dirname(packagedExecutable),
  env: { ...smokeEnvironment, ORS_DESIGN_EVIDENCE_PATH: designEvidencePath },
  stdio: 'inherit',
  timeout: 300_000,
  windowsHide: true
});

console.log('Packaged desktop product-design acceptance passed.');

execFileSync(process.execPath, [path.join(__dirname, 'verify-windows-install-lifecycle.cjs')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
});

execFileSync(process.execPath, [path.join(__dirname, 'write-release-evidence.cjs'), ...(productionRelease ? ['--production-release'] : [])], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
});

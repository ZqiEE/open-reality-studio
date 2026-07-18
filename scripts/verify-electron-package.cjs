'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { writeAuthenticodeEvidence } = require('./windows-authenticode.cjs');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const resourcesDir = path.join(releaseDir, 'win-unpacked', 'resources');
const asarPath = path.join(resourcesDir, 'app.asar');
const unpackedAppDir = path.join(resourcesDir, 'app.asar.unpacked');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productionRelease = process.argv.includes('--production-release');

function findFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const matches = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (predicate(absolute)) matches.push(absolute);
    }
  }
  return matches;
}

function readPackagedEntry(entry) {
  const unpackedPath = path.join(unpackedAppDir, ...entry.split('/'));
  if (fs.existsSync(unpackedPath)) return fs.readFileSync(unpackedPath);
  return asar.extractFile(asarPath, entry);
}

assert(fs.existsSync(asarPath), `packaged app archive missing: ${asarPath}`);
const entries = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/')));
for (const required of [
  'package.json',
  'dist-electron/main.js',
  'dist-electron-runtime/lib/hardware/index.js',
  'dist-electron-runtime/lib/hardware/RealExecutionReleaseApproval.js',
  '.next-build/BUILD_ID',
  'node_modules/next/dist/bin/next',
  'node_modules/pdfjs-dist/package.json',
  'node_modules/serialport/package.json',
  'assets/branding/realitywarden.ico'
]) {
  assert(entries.has(required), `app.asar is missing required entry: ${required}`);
}

const packagedMetadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
assert.equal(packagedMetadata.version, packageJson.version, 'packaged app version must match package.json');
assert.equal(packagedMetadata.main, 'dist-electron/main.js', 'packaged app main entry must target the compiled Electron process');
assert.equal(packagedMetadata.dependencies?.['pdfjs-dist'], '4.10.38', 'packaged app must retain the pinned PDF extraction runtime');

// Next 16 (Turbopack) emits flat hash-named chunks under static/chunks/ rather
// than the older app/page-[hash].js layout. Scan every top-level JS chunk so
// the UI-presence assertions below stay valid across bundler output changes
// (this is equal-or-stronger: it searches a superset of the old app chunk).
const manualImportChunks = Array.from(entries).filter((entry) => /^\.next-build\/static\/chunks\/[^/]+\.js$/.test(entry));
assert(manualImportChunks.length > 0, 'packaged Next output is missing the main application chunk');
const mainApplicationBundle = manualImportChunks.map((entry) => readPackagedEntry(entry).toString('utf8')).join('\n');
assert(mainApplicationBundle.includes('Import Device Manual'), 'packaged UI is missing the manual-import entry point');
assert(mainApplicationBundle.includes('SIMULATION ONLY'), 'packaged manual-import UI is missing its simulation-only boundary');

const unpackedBindings = findFiles(
  path.join(unpackedAppDir, 'node_modules', '@serialport', 'bindings-cpp'),
  (file) => file.endsWith('.node') && file.toLowerCase().includes('win32')
);
assert(unpackedBindings.length > 0, 'serialport Windows native binding must be present outside app.asar');
for (const required of [
  '.next-build/BUILD_ID',
  'next.config.mjs',
  'node_modules/next/dist/bin/next'
]) {
  assert(fs.existsSync(path.join(unpackedAppDir, ...required.split('/'))), `Next server runtime must be unpacked to a real filesystem path: ${required}`);
}

const firmwareDir = path.join(resourcesDir, 'firmware', 'prebuilt');
const firmwareImages = findFiles(firmwareDir, (file) => file.endsWith('.merged.bin'));
assert(firmwareImages.length > 0, 'prebuilt ESP32 firmware image must be included in resources/firmware/prebuilt');
for (const image of firmwareImages) {
  const companion = `${image}.sha256`;
  assert(fs.existsSync(companion), `firmware sha256 companion missing: ${path.basename(companion)}`);
  const expected = fs.readFileSync(companion, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
  assert.equal(actual, expected, `packaged firmware integrity check failed: ${path.basename(image)}`);
}

const sourceMarketplaceDistribution = path.join(root, 'marketplace', 'distribution.json');
if (fs.existsSync(sourceMarketplaceDistribution)) {
  const packagedMarketplaceDistribution = path.join(resourcesDir, 'marketplace', 'distribution.json');
  assert(fs.existsSync(packagedMarketplaceDistribution), 'provisioned Marketplace distribution config must be packaged as an external resource');
  assert.deepEqual(
    fs.readFileSync(packagedMarketplaceDistribution),
    fs.readFileSync(sourceMarketplaceDistribution),
    'packaged Marketplace distribution config must exactly match the release-provisioned input'
  );
}
if (productionRelease && !fs.existsSync(sourceMarketplaceDistribution)) throw new Error('production package verification requires the provisioned Marketplace distribution config');

const executable = path.join(releaseDir, 'win-unpacked', 'RealityWarden.exe');
const supportDir = path.join(resourcesDir, 'support');
for (const required of ['SUPPORT.md', 'SUPPORT.html', 'WINDOWS_TRIAL_GUIDE.md', 'EVALUATION_GUIDE.md', 'REAL_HARDWARE_ESP32.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.html']) {
  assert(fs.existsSync(path.join(supportDir, required)), `packaged offline support resource missing: ${required}`);
}
const packagedSupport = fs.readFileSync(path.join(supportDir, 'SUPPORT.md'), 'utf8');
assert(packagedSupport.includes('does not upload it') && packagedSupport.includes('REAL HARDWARE'), 'packaged support guide must retain privacy and hardware boundaries');
const packagedSupportHtml = fs.readFileSync(path.join(supportDir, 'SUPPORT.html'), 'utf8');
assert(packagedSupportHtml.includes('RealityWarden does not upload it') && packagedSupportHtml.includes('REAL HARDWARE boundary'), 'packaged in-app support page must retain privacy and hardware boundaries');
const releaseApprovalRuntime = require(path.join(root, 'dist-electron-runtime', 'lib', 'hardware', 'RealExecutionReleaseApproval.js'));
const packagedReleaseApproval = releaseApprovalRuntime.verifyRealExecutionReleaseApproval({
  appVersion: packageJson.version,
  evidenceDir: path.join(supportDir, 'acceptance', 'evidence')
});
assert(packagedReleaseApproval.approved && packagedReleaseApproval.evidenceCount === 4, `packaged REAL execution approval failed: ${packagedReleaseApproval.reason ?? 'unknown'}`);
const packagedNotices = fs.readFileSync(path.join(supportDir, 'THIRD_PARTY_NOTICES.html'), 'utf8');
assert(packagedNotices.includes('CycloneDX') && packagedNotices.includes('UR5e derived GLB') && packagedNotices.includes('TurtleBot3 Burger derived GLB'), 'packaged notices must cover the production dependency inventory and redistributed model assets');

assert(fs.existsSync(executable), 'branded RealityWarden executable is missing from win-unpacked');
assert(fs.existsSync(path.join(root, packageJson.build.win.icon)), 'configured Windows icon is missing');
assert.equal(packageJson.build.afterPack, 'scripts/after-pack.cjs', 'Windows branding hook must run after packaging');
assert.equal(packageJson.build.win.executableName, 'RealityWarden', 'Windows executable name must stay branded');
assert.equal(packageJson.build.nsis.installerIcon, packageJson.build.win.icon, 'NSIS installer must use the branded icon');
assert.equal(packageJson.build.nsis.uninstallerIcon, packageJson.build.win.icon, 'NSIS uninstaller must use the branded icon');

const installerName = `RealityWarden-${packageJson.version}-Setup.exe`;
const installer = path.join(releaseDir, installerName);
assert(fs.existsSync(installer), `NSIS installer missing: ${installerName}`);
assert(fs.statSync(installer).size > 1024 * 1024, 'NSIS installer is unexpectedly small');

let authenticodeEvidence = null;
if (productionRelease) authenticodeEvidence = writeAuthenticodeEvidence(root, packageJson.version);

console.log('Electron package verification passed.');
console.log(`- Installer: ${installerName}`);
console.log('- Compiled Electron + shared safety runtime + Next production output are present.');
console.log('- Manual/PDF import UI and pinned pdfjs runtime are present.');
console.log(`- serialport native binding(s): ${unpackedBindings.length}`);
console.log(`- Firmware image(s) with valid sha256: ${firmwareImages.length}`);
console.log(`- Marketplace distribution config: ${fs.existsSync(sourceMarketplaceDistribution) ? 'present and byte-exact' : 'not provisioned (development package)'}`);
console.log('- Offline support guide and recovery references are present.');
console.log(`- REAL execution release approval: ${packagedReleaseApproval.approvalId} (4/4 digest-bound scenarios).`);
console.log('- Branded executable, installer, and uninstaller icon configuration is present.');
console.log(`- Authenticode: ${authenticodeEvidence ? `Valid for EXE and installer; evidence ${path.basename(authenticodeEvidence.evidencePath)}` : 'not assessed (internal acceptance package)'}`);

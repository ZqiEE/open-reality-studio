const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const readme = read('README.md');
const windowsTrialGuide = read('docs/WINDOWS_TRIAL_GUIDE.md');
const evaluationGuide = read('docs/EVALUATION_GUIDE.md');
const deviceSupport = read('docs/DEVICE_SUPPORT.md');
const releaseNotes = read('docs/RELEASE_NOTES_V0.5.1.md');
const releaseReadiness = read('docs/RELEASE_READINESS_V0.5.1.md');
const publicLaunchCopy = read('docs/PUBLIC_LAUNCH_COPY.md');
const commercialPositioning = read('docs/COMMERCIAL_POSITIONING.md');
const customerValidation = read('docs/CUSTOMER_VALIDATION.md');
const demoScript = read('docs/DEMO_SCRIPT.md');
const desktopApp = read('docs/DESKTOP_APP.md');
const archivedSocialCopy = read('docs/SOCIAL_MEDIA_LAUNCH_PACK.md');
const packScript = read('scripts/pack-electron.cjs');
const packageVerification = read('scripts/verify-electron-package.cjs');
const productionReleaseGate = read('scripts/verify-marketplace-release-config.cjs');
const authenticodeVerifier = read('scripts/windows-authenticode.cjs');
const noticeGenerator = read('scripts/generate-third-party-notices.cjs');
const thirdPartyNotices = read('docs/THIRD_PARTY_NOTICES.md');
const legalReleaseInputs = read('scripts/legal-release-inputs.cjs');
const gitignore = read('.gitignore');

const version = packageJson.version;
const expectedInstallerName = `RLSOK-${version}-Setup.exe`;

assert(/^\d+\.\d+\.\d+$/.test(version), 'package.json version must use semver-like x.y.z format.');
assert.equal(packageLock.version, version, 'package-lock.json version must match package.json.');
assert.equal(packageLock.packages[''].version, version, 'package-lock root package version must match package.json.');

assert.equal(packageJson.build?.asar, true, 'electron-builder must package the desktop app with asar enabled.');
assert.equal(
  packageJson.build?.win?.artifactName,
  'RLSOK-${version}-Setup.${ext}',
  'Windows installer artifact naming must stay versioned and predictable.'
);
assert.equal(packageJson.build?.nsis?.runAfterFinish, false, 'Release installers must not auto-launch outside the explicit lifecycle smoke.');
assert.equal(packageJson.build?.nsis?.deleteAppDataOnUninstall, false, 'Uninstall must preserve user projects and preferences by default.');
assert.equal(packageJson.build?.nsis?.shortcutName, 'RLSOK', 'Installed shortcuts must use the product name.');
assert.equal(packageJson.build?.win?.signAndEditExecutable, true, 'Windows release packaging must keep executable signing enabled.');
assert(packageJson.scripts?.['desktop:pack:production']?.includes('verify-marketplace-release-config.cjs'), 'production packaging must run the Marketplace and code-signing input gate first.');
assert(packageJson.scripts?.['marketplace:catalog:publish']?.includes('run-marketplace-catalog-publish.cjs'), 'release operations must expose the governed offline Marketplace catalog publisher.');
assert(packageJson.scripts?.['marketplace:live:verify']?.includes('run-marketplace-live-verify.cjs'), 'release operations must expose the exact live Marketplace distribution verifier.');
assert(packageJson.scripts?.['release:prepare-public'] === 'node scripts/prepare-public-release.cjs', 'release operations must expose the final fail-closed public handoff gate.');
assert(packageJson.scripts?.['release:supply-chain'] === 'node scripts/write-supply-chain-evidence.cjs', 'release operations must expose lockfile-bound audit and SBOM evidence generation.');
assert(packageJson.scripts?.['release:legal:verify'] === 'node scripts/legal-release-inputs.cjs', 'release operations must expose owner legal input verification.');
assert(packageJson.scripts?.['notices:check'] === 'node scripts/generate-third-party-notices.cjs --check', 'release operations must expose deterministic third-party notice verification.');
assert(packageJson.scripts?.['desktop:pack:production']?.includes('--production-release'), 'production packaging must explicitly request post-build production verification.');
assert(packageJson.build?.extraResources?.some((resource) => resource.from === 'marketplace' && resource.filter?.includes('distribution.json')), 'Marketplace distribution config must be packaged as an external release resource.');

assert.equal(version, '0.5.1', 'This release closure must remain pinned to v0.5.1.');
assert(readme.startsWith('# RLSOK') && readme.includes('Only RLSOK releases reach the robot.'), 'README must state the RLSOK release-control product.');
assert(readme.includes('Headless ReleaseGate Core | Implemented') && readme.includes('ROS 2 Jazzy/rclpy Shadow and restricted trajectory gateway | Experimental reference implementation'), 'README must publish current core and experimental ROS 2 implementation status.');
assert(readme.includes('reference execution adapter') && readme.includes('not the primary product target'), 'README must describe the reference-hardware boundary without making it the product.');
assert(!readme.includes('local PDF/Markdown/text manual import'), 'README must not advertise the retired manual-import workflow.');
assert(readme.includes('Marketplace and Manual Import are not RLSOK product features'), 'README must state the compatibility-only status of retired product modules.');

assert(windowsTrialGuide.includes('REAL-device-first Public Alpha') && windowsTrialGuide.includes('If you do not have the rig') && windowsTrialGuide.includes('select SIM LAB'), 'Windows trial guide must state the REAL-first boundary and explicit no-hardware simulation path.');
assert(windowsTrialGuide.includes('not general-purpose') && windowsTrialGuide.includes('production-certified'), 'Windows trial guide must state the real-hardware limitation.');
assert(windowsTrialGuide.includes(expectedInstallerName), 'Windows trial guide must reference the current installer version.');
for (const prompt of ['Move the red cube to the back safe zone', 'Turn on the light', 'Take a photo']) {
  assert(windowsTrialGuide.includes(prompt), `Windows trial guide must include first-run prompt: ${prompt}`);
}
for (const prompt of ['把红方块放到后侧安全区', '打开智能灯', '拍一张照片']) {
  assert(windowsTrialGuide.includes(prompt), `Windows trial guide must include localized first-run prompt: ${prompt}`);
}

assert(evaluationGuide.includes(`v${version} Public Alpha`), 'Evaluation guide must reference the current public alpha version.');
assert(evaluationGuide.includes('REAL-device-first') && evaluationGuide.includes('SIM LAB is a separate') && evaluationGuide.includes('zero-signal mode'), 'Evaluation guide must preserve REAL-first and explicit Simulation Lab boundaries.');
assert(evaluationGuide.includes('Known unsupported example'), 'Evaluation guide must include unsupported prompt examples.');
assert(evaluationGuide.includes('Language Note'), 'Evaluation guide must explain how to use the documented bilingual prompt paths.');
for (const prompt of ['把红方块放到后侧安全区', '把灯改成蓝色', '拍一张照片']) {
  assert(evaluationGuide.includes(prompt), `Evaluation guide must include localized prompt: ${prompt}`);
}
for (const garbledChunk of ['閹?', '閺?', '閹殿偅', '鐠囪', '鎶婄孩', '鎵撳紑', '鎷嶄竴']) {
  assert(!windowsTrialGuide.includes(garbledChunk), `Windows trial guide must not contain mojibake chunk: ${garbledChunk}`);
  assert(!evaluationGuide.includes(garbledChunk), `Evaluation guide must not contain mojibake chunk: ${garbledChunk}`);
}

assert(
  deviceSupport.includes('ROS 2 gateway contract') &&
    deviceSupport.includes('Live ROS 2 / DDS / SROS 2 network') &&
    deviceSupport.includes('ESP32 servo rig'),
  'Integration support must distinguish implemented contracts, missing live ROS 2, and the reference adapter.'
);
assert(!deviceSupport.includes('Coming Soon'), 'Device support documentation must not advertise unsupported families as Coming Soon product cards.');

for (const document of [releaseNotes, releaseReadiness]) {
  assert(document.includes(`v${version}`), 'Release documents must reference the package version.');
  assert(document.includes('Public Alpha'), 'Release documents must retain the Public Alpha maturity label.');
  assert(document.includes('48/48') && document.includes('5/5') && document.includes('21/21'), 'Release documents must carry current automated safety and manual-import/action-install evidence.');
  assert(document.includes('command_acknowledged_open_loop'), 'Release documents must state open-loop acknowledgement semantics.');
  assert(!document.includes('production-ready'), 'Release documents must not claim production readiness.');
}
assert(releaseNotes.includes("supported_adapters:['simulator']"), 'Release notes must state the permanent manual-asset adapter boundary.');
assert(publicLaunchCopy.includes(`v${version} Public Alpha`), 'Public launch copy must reference the current version.');
assert(publicLaunchCopy.includes('evidence-locked REAL HARDWARE'), 'Public launch copy must describe the separate gated hardware boundary.');
for (const publicDocument of [publicLaunchCopy, commercialPositioning, customerValidation]) {
  assert(!publicDocument.includes('- no real device execution'), 'Public positioning must not falsely claim the reference real-hardware path does not exist.');
  assert(!publicDocument.includes('- simulation-only\n'), 'Public positioning must not describe the entire product as simulation-only.');
}

assert(demoScript.includes('REAL-device-first') && demoScript.includes('one documented ESP32 reference rig only'), 'Demo script must state the honest REAL-first reference-rig boundary.');
assert(demoScript.includes('SIM LAB remains a separately selected') && demoScript.includes('zero-signal tool'), 'Demo script must keep Simulation Lab separate and non-fallback.');
assert(archivedSocialCopy.includes('Historical v0.1.1 copy') && archivedSocialCopy.includes('Do not publish'), 'Stale social copy must be visibly archived.');
assert(desktopApp.includes('packaged first-run renderer smoke') && desktopApp.includes('Any missing contract exits non-zero'), 'Desktop packaging docs must describe the renderer smoke scope and its fail-closed exit behavior.');
assert(packScript.includes("['--prod', '--smoke-test']"), 'desktop:pack must run the packaged production smoke path.');
assert(packScript.includes('delete smokeEnvironment.ELECTRON_RUN_AS_NODE'), 'packaged smoke must not inherit Electron run-as-node mode.');
assert(packScript.includes('write-release-evidence.cjs'), 'desktop:pack must write machine-readable evidence only after packaged smoke passes.');
assert(packScript.includes('verify-windows-install-lifecycle.cjs'), 'desktop:pack must run the isolated Windows install lifecycle before release evidence is written.');
assert(packScript.includes("['--prod', '--design-smoke-test']"), 'desktop:pack must run the packaged responsive and accessibility design matrix.');
assert(packScript.includes("['--prod', '--startup-design-smoke-test']"), 'desktop:pack must run the packaged launch and startup recovery matrix.');
for (const packageContract of ['SIMULATION ONLY']) {
  assert(packageVerification.includes(packageContract), `Package verification must cover ${packageContract}.`);
}
assert(packageVerification.includes('packaged Marketplace distribution config must exactly match'), 'package verification must bind the external Marketplace config byte-for-byte.');
assert(noticeGenerator.includes("'sbom', '--omit', 'dev', '--sbom-format', 'cyclonedx'") && noticeGenerator.includes("'third_party', 'model-assets', 'provenance.json'") && noticeGenerator.includes('model runtime digest mismatch') && noticeGenerator.includes('model license digest mismatch'), 'third-party notices must derive from the npm production CycloneDX inventory and digest-bound model provenance.');
assert(thirdPartyNotices.includes('UR5e derived GLB') && thirdPartyNotices.includes('BSD-3-Clause') && thirdPartyNotices.includes('TurtleBot3 Burger derived GLB') && thirdPartyNotices.includes('Apache-2.0'), 'third-party notices must cover both redistributed model assets and their licenses.');
assert(productionReleaseGate.includes('productionRequired: true') && productionReleaseGate.includes('WIN_CSC_LINK') && productionReleaseGate.includes('CSC_LINK') && productionReleaseGate.includes('validateLegalInputs(root)'), 'production release gate must require authoritative distribution validation, a Windows signing certificate, and owner legal inputs.');
assert(packScript.includes('validateLegalReleaseInputs(root)') && packScript.includes('--config.nsis.license='), 'production packaging must independently revalidate and pass the approved EULA to NSIS.');
assert(legalReleaseInputs.includes('contains missing or unknown fields') && legalReleaseInputs.includes('contains placeholder text') && legalReleaseInputs.includes('sha256 mismatch') && legalReleaseInputs.includes('must identify the publisher legal name'), 'owner legal input validation must be strict, placeholder-free, digest-bound, and publisher-bound.');
assert(authenticodeVerifier.includes("status !== 'Valid'") && authenticodeVerifier.includes('timestamp is missing') && authenticodeVerifier.includes('validateAuthenticodeEvidence'), 'production release must independently verify Valid timestamped Authenticode evidence.');

for (const ignoredPath of ['/release/', 'demo/', '.next-build/', 'dist-electron/', '.env', 'marketplace/distribution.json', '/release-inputs/legal/manifest.json', '/release-inputs/legal/PRODUCT_EULA.txt', '/release-inputs/legal/PRIVACY_NOTICE.txt']) {
  assert(gitignore.includes(ignoredPath), `.gitignore must ignore ${ignoredPath}.`);
}

console.log('Release consistency tests passed.');
console.log(`- Version ${version} is aligned across package metadata and installer naming.`);
console.log('- README, evaluation, trial, release-note, and readiness docs agree on the Public Alpha boundaries.');
console.log('- Desktop packaging remains configured as a releasable installer path.');

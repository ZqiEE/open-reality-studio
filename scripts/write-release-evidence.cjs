'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { validateLifecycleEvidence } = require('./verify-windows-install-lifecycle.cjs');
const { validateAuthenticodeEvidence } = require('./windows-authenticode.cjs');
const { validateLegalReleaseInputs } = require('./legal-release-inputs.cjs');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} missing: ${file}`);
  return file;
}

function requireMatchingChecksum(file, label) {
  const checksumFile = requireFile(`${file}.sha256`, `${label} checksum`);
  const digest = sha256File(file);
  const recorded = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0].toUpperCase();
  if (recorded !== digest) throw new Error(`${label} checksum mismatch: ${path.basename(file)}`);
  return digest;
}

function validateDesignEvidence(evidence) {
  if (evidence?.schema !== 'realitywarden.product-design-acceptance' || evidence?.schema_version !== 1) throw new Error('Invalid product-design acceptance evidence schema.');
  for (const gate of ['responsive_layout', 'bilingual_content', 'windows_scaling', 'dialog_boundaries', 'keyboard_focus', 'forced_colors']) {
    if (evidence.gates?.[gate] !== 'passed') throw new Error(`Product-design acceptance gate did not pass: ${gate}`);
  }
  const layouts = Array.isArray(evidence.layouts) ? evidence.layouts : [];
  const realWorkspaceLayouts = Array.isArray(evidence.real_workspace_layouts) ? evidence.real_workspace_layouts : [];
  for (const contract of [[1440, 900, 'zh'], [1440, 900, 'en'], [1180, 720, 'zh'], [1180, 720, 'en']]) {
    if (!layouts.some((item) => item?.viewport?.width === contract[0] && item?.viewport?.height === contract[1] && item?.language === contract[2] && item?.toolbar?.realDeviceControl === false && item?.toolbar?.simulationToolbarActions === 5 && item?.toolbar?.simulationFileActions === 2 && item?.violations?.length === 0)) throw new Error(`Product-design viewport evidence missing: ${contract.join('x')}`);
    if (!realWorkspaceLayouts.some((item) => item?.mode === 'real' && item?.viewport?.width === contract[0] && item?.viewport?.height === contract[1] && item?.language === contract[2] && item?.toolbar?.realDeviceControl === true && item?.toolbar?.simulationToolbarActions === 0 && item?.toolbar?.simulationFileActions === 0 && item?.toolbar?.hardwareFocused === true && item?.workspaceState?.disconnectedOnboarding === true && item?.workspaceState?.realTwinStage === false && item?.workspaceState?.canvasCount === 0 && item?.violations?.length === 0)) throw new Error(`REAL-workspace viewport evidence missing: ${contract.join('x')}`);
  }
  const scales = new Set((Array.isArray(evidence.scaling) ? evidence.scaling : []).map((item) => item?.requestedScale));
  if (!scales.has(1.25) || !scales.has(1.5)) throw new Error('Product-design Windows scaling evidence is incomplete.');
  const dialogs = new Set((Array.isArray(evidence.dialogs) ? evidence.dialogs : []).filter((item) => item?.status === 'passed' && item?.focusRestored === true).map((item) => item.id));
  for (const dialog of ['action-composer', 'asset-import', 'manual-import', 'marketplace']) if (!dialogs.has(dialog)) throw new Error(`Product-design dialog evidence missing: ${dialog}`);
  if (evidence.contrast?.forcedColors !== true || evidence.contrast?.hardwareBorderStyle !== 'double') throw new Error('Product-design forced-colors evidence is incomplete.');
  return evidence;
}

function validateStartupEvidence(evidence) {
  if (evidence?.schema !== 'realitywarden.startup-design-acceptance' || evidence?.schema_version !== 1) throw new Error('Invalid startup-design acceptance evidence schema.');
  for (const gate of ['no_flash_tokens', 'responsive_layout', 'bilingual_content', 'windows_scaling', 'failure_recovery', 'reduced_motion', 'forced_colors']) {
    if (evidence.gates?.[gate] !== 'passed') throw new Error(`Startup-design acceptance gate did not pass: ${gate}`);
  }
  const layouts = Array.isArray(evidence.layouts) ? evidence.layouts : [];
  for (const contract of [[1440, 900, 'zh'], [1440, 900, 'en'], [1180, 720, 'zh'], [1180, 720, 'en']]) {
    if (!layouts.some((item) => item?.viewport?.width === contract[0] && item?.viewport?.height === contract[1] && item?.language === contract[2] && item?.violations?.length === 0)) throw new Error(`Startup-design viewport evidence missing: ${contract.join('x')}`);
  }
  const scales = new Set((Array.isArray(evidence.scaling) ? evidence.scaling : []).map((item) => item?.requested));
  if (!scales.has(1.25) || !scales.has(1.5)) throw new Error('Startup-design Windows scaling evidence is incomplete.');
  if (evidence.reduced_motion?.matches !== true || evidence.reduced_motion?.animationName !== 'none') throw new Error('Startup-design reduced-motion evidence is incomplete.');
  if (evidence.forced_colors?.matches !== true || evidence.forced_colors?.borderLeftStyle !== 'double' || evidence.forced_colors?.focusVisible !== true) throw new Error('Startup-design forced-colors evidence is incomplete.');
  return evidence;
}

function readSourceRevision(root) {
  try {
    const commandOptions = { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], commandOptions).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], commandOptions).trim();
    return { commit, worktree: status ? 'dirty' : 'clean' };
  } catch {
    return { commit: null, worktree: 'unavailable' };
  }
}

function buildReleaseEvidence(root, generatedAt = new Date().toISOString(), options = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const releaseDir = path.join(root, 'release');
  const installerName = `RealityWarden-${packageJson.version}-Setup.exe`;
  const installer = requireFile(path.join(releaseDir, installerName), 'NSIS installer');
  const executable = requireFile(path.join(releaseDir, 'win-unpacked', 'RealityWarden.exe'), 'Packaged executable');
  const installerSha256 = sha256File(installer);
  const executableSha256 = sha256File(executable);
  const buildIdFile = requireFile(path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', '.next-build', 'BUILD_ID'), 'Packaged Next BUILD_ID');
  const lifecycleName = `RealityWarden-${packageJson.version}-Install-Lifecycle.json`;
  const lifecycleFile = requireFile(path.join(releaseDir, lifecycleName), 'Windows install lifecycle evidence');
  const lifecycleHashFile = requireFile(`${lifecycleFile}.sha256`, 'Windows install lifecycle evidence checksum');
  const lifecycleHash = sha256File(lifecycleFile);
  const recordedLifecycleHash = fs.readFileSync(lifecycleHashFile, 'utf8').trim().split(/\s+/)[0].toUpperCase();
  if (recordedLifecycleHash !== lifecycleHash) throw new Error(`Windows install lifecycle evidence checksum mismatch: ${lifecycleName}`);
  const lifecycle = validateLifecycleEvidence(JSON.parse(fs.readFileSync(lifecycleFile, 'utf8')), packageJson.version, installerSha256);
  const designName = `RealityWarden-${packageJson.version}-Design-Acceptance.json`;
  const designFile = requireFile(path.join(releaseDir, designName), 'Product-design acceptance evidence');
  const designHash = requireMatchingChecksum(designFile, 'Product-design acceptance evidence');
  const design = validateDesignEvidence(JSON.parse(fs.readFileSync(designFile, 'utf8')));
  const startupName = `RealityWarden-${packageJson.version}-Startup-Acceptance.json`;
  const startupFile = requireFile(path.join(releaseDir, startupName), 'Startup-design acceptance evidence');
  const startupHash = requireMatchingChecksum(startupFile, 'Startup-design acceptance evidence');
  const startup = validateStartupEvidence(JSON.parse(fs.readFileSync(startupFile, 'utf8')));
  const productionRelease = options.productionRelease === true;
  let codeSigning = { status: 'not_assessed', evidence_file: null, evidence_sha256: null, artifacts: [] };
  let legalRelease = { status: 'not_assessed', input_manifest_sha256: null, publisher: null, sales_jurisdictions: [], documents: {} };
  if (productionRelease) {
    const signingName = `RealityWarden-${packageJson.version}-Authenticode-Evidence.json`;
    const signingFile = requireFile(path.join(releaseDir, signingName), 'Windows Authenticode evidence');
    const signingHash = requireMatchingChecksum(signingFile, 'Windows Authenticode evidence');
    const signing = validateAuthenticodeEvidence(JSON.parse(fs.readFileSync(signingFile, 'utf8')), packageJson.version, {
      'win-unpacked/RealityWarden.exe': executableSha256,
      [installerName]: installerSha256
    });
    codeSigning = { status: 'passed', evidence_file: signingName, evidence_sha256: signingHash, artifacts: signing.artifacts };
    const legal = (options.validateLegalInputs ?? validateLegalReleaseInputs)(root);
    legalRelease = {
      status: 'passed',
      input_manifest_sha256: legal.manifest_sha256.toUpperCase(),
      approved_at: legal.approved_at,
      approved_by: legal.approved_by,
      approval_reference: legal.approval_reference,
      publisher: legal.publisher,
      sales_jurisdictions: legal.sales_jurisdictions,
      documents: {
        eula: { file: legal.documents.eula.file, sha256: legal.documents.eula.sha256.toUpperCase(), size_bytes: legal.documents.eula.size_bytes },
        privacy_notice: { file: legal.documents.privacy_notice.file, sha256: legal.documents.privacy_notice.sha256.toUpperCase(), size_bytes: legal.documents.privacy_notice.size_bytes }
      }
    };
  }

  return {
    schema: 'realitywarden.release-evidence',
    schema_version: 6,
    product: 'RealityWarden',
    release_version: packageJson.version,
    release_mode: productionRelease ? 'production' : 'internal_acceptance',
    generated_at: generatedAt,
    source: readSourceRevision(root),
    artifact: {
      file: installerName,
      size_bytes: fs.statSync(installer).size,
      sha256: installerSha256
    },
    packaged_app: {
      executable: 'win-unpacked/RealityWarden.exe',
      size_bytes: fs.statSync(executable).size,
      sha256: executableSha256,
      next_build_id: fs.readFileSync(buildIdFile, 'utf8').trim()
    },
    install_lifecycle: {
      file: lifecycleName,
      sha256: lifecycleHash,
      user_data_policy: lifecycle.user_data_policy
    },
    product_design_acceptance: {
      file: designName,
      sha256: designHash,
      gates: design.gates
    },
    startup_design_acceptance: {
      file: startupName,
      sha256: startupHash,
      gates: startup.gates
    },
    code_signing: codeSigning,
    legal_release: legalRelease,
    gates: [
      {
        id: 'electron-package-contract',
        status: 'passed',
        evidence: 'scripts/verify-electron-package.cjs completed before this record was written'
      },
      {
        id: 'packaged-first-run-renderer-smoke',
        status: 'passed',
        evidence: 'Packaged renderer loaded AppHeader, DeviceNavigator, CommandDock, one Run/Stop pair, simulation and REAL HARDWARE boundaries, and preload bridge'
      },
      {
        id: 'windows-install-lifecycle',
        status: 'passed',
        evidence: 'Isolated current-user clean install, installed first run, forced-offline degradation, in-place reinstall, uninstall cleanup, and user-data preservation passed'
      },
      {
        id: 'product-design-acceptance',
        status: 'passed',
        evidence: '1440x900 and 1180x720 bilingual layouts, 125%/150% scale, dialogs, focus return, and forced-colors boundaries passed'
      },
      {
        id: 'startup-design-acceptance',
        status: 'passed',
        evidence: 'Neutral dark launch shell, bilingual responsive layouts, 125%/150% scale, escaped recovery details, reduced motion, and forced colors passed'
      },
      {
        id: 'windows-authenticode',
        status: productionRelease ? 'passed' : 'not_assessed',
        evidence: productionRelease ? 'Both packaged RealityWarden.exe and the NSIS installer have Valid timestamped Authenticode signatures bound to exact artifact digests' : 'Internal acceptance package; Authenticode was not assessed'
      },
      {
        id: 'owner-legal-release-inputs',
        status: productionRelease ? 'passed' : 'not_assessed',
        evidence: productionRelease ? 'Owner-approved publisher identity, sales jurisdictions, EULA, and privacy notice are version- and digest-bound; the EULA is supplied to NSIS' : 'Internal acceptance package; owner legal release inputs were not assessed'
      }
    ],
    not_claimed: {
      ...(productionRelease ? {} : { code_signing: 'not assessed by this internal-acceptance record' }),
      ...(productionRelease ? {} : { owner_legal_release_inputs: 'not assessed by this internal-acceptance record' }),
      physical_hardware_acceptance: 'optional evidence; not assessed by this record',
      physical_outcome: 'not inferred from packaged startup or command acknowledgement'
    }
  };
}

function writeReleaseEvidence(root, generatedAt, options) {
  const evidence = buildReleaseEvidence(root, generatedAt, options);
  const releaseDir = path.join(root, 'release');
  const evidenceName = `RealityWarden-${evidence.release_version}-Release-Evidence.json`;
  const evidencePath = path.join(releaseDir, evidenceName);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(evidencePath, serialized, 'utf8');
  const digest = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
  fs.writeFileSync(`${evidencePath}.sha256`, `${digest}  ${evidenceName}\n`, 'utf8');
  return { evidence, evidencePath, digest };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = writeReleaseEvidence(root, undefined, { productionRelease: process.argv.includes('--production-release') });
  console.log('Release evidence written.');
  console.log(`- Manifest: ${path.basename(result.evidencePath)}`);
  console.log(`- Installer SHA256: ${result.evidence.artifact.sha256}`);
  console.log(`- Manifest SHA256: ${result.digest}`);
  console.log(`- Release mode: ${result.evidence.release_mode}; Authenticode: ${result.evidence.code_signing.status}`);
}

module.exports = { buildReleaseEvidence, sha256File, validateDesignEvidence, validateStartupEvidence, writeReleaseEvidence };

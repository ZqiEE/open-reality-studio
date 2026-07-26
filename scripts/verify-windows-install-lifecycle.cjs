'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIFECYCLE_PREFIX = 'RLSOK-install-lifecycle-';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertSafeLifecycleRoot(candidate) {
  const resolved = path.resolve(candidate);
  assert(isPathInside(os.tmpdir(), resolved), `Lifecycle root must be inside the OS temporary directory: ${resolved}`);
  assert(path.basename(resolved).startsWith(LIFECYCLE_PREFIX), `Lifecycle root must use the dedicated prefix: ${resolved}`);
  return resolved;
}

function queryRlsokRegistrations() {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];
  const matches = [];
  for (const root of roots) {
    try {
      const output = execFileSync('reg.exe', ['query', root, '/s', '/f', 'RLSOK', '/d'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (output) matches.push(output);
    } catch {
      // reg.exe exits 1 when no matching registration exists.
    }
  }
  return matches;
}

function findInstalledExecutable(lifecycleRoot) {
  const pending = [assertSafeLifecycleRoot(lifecycleRoot)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name.toLowerCase() === 'rlsok.exe') return absolute;
    }
  }
  return null;
}

function runExecutable(executable, args, cwd, timeout = 300_000) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  execFileSync(executable, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    timeout,
    windowsHide: true
  });
}

function waitForUninstallCompletion(target, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payloadRemoved = !fs.existsSync(target) || fs.readdirSync(target).length === 0;
    const registrationRemoved = queryRealityWardenRegistrations().length === 0;
    if (payloadRemoved && registrationRemoved) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  const remaining = fs.existsSync(target) ? fs.readdirSync(target) : [];
  assert.deepEqual(remaining, [], `Uninstaller left application payload in ${target}: ${remaining.join(', ')}`);
  assert.equal(queryRealityWardenRegistrations().length, 0, 'Uninstall registration must be removed.');
}

function validateLifecycleEvidence(evidence, expectedVersion, expectedInstallerHash) {
  assert.equal(evidence.schema, 'realitywarden.windows-install-lifecycle');
  assert.equal(evidence.schema_version, 2);
  assert.equal(evidence.release_version, expectedVersion);
  assert.equal(evidence.installer.sha256, expectedInstallerHash);
  for (const gate of ['clean_install', 'installed_first_run', 'installed_core_journey', 'offline_degradation', 'in_place_reinstall', 'uninstall']) {
    assert.equal(evidence.gates[gate], 'passed', `Lifecycle gate must pass: ${gate}`);
  }
  assert.equal(evidence.user_data_policy.reinstall_preserved, true);
  assert.equal(evidence.user_data_policy.uninstall_preserved, true);
  return evidence;
}

function writeLifecycleEvidence(root, evidence) {
  const releaseDir = path.join(root, 'release');
  const name = `RLSOK-${evidence.release_version}-Install-Lifecycle.json`;
  const target = path.join(releaseDir, name);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(target, serialized, 'utf8');
  const digest = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
  fs.writeFileSync(`${target}.sha256`, `${digest}  ${name}\n`, 'utf8');
  return { target, digest };
}

function verifyWindowsInstallLifecycle(root, generatedAt = new Date().toISOString()) {
  assert.equal(process.platform, 'win32', 'The NSIS lifecycle gate must run on Windows.');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const installerName = `RLSOK-${packageJson.version}-Setup.exe`;
  const installer = path.join(root, 'release', installerName);
  assert(fs.existsSync(installer), `Installer missing: ${installer}`);

  const preexisting = queryRlsokRegistrations();
  assert.equal(preexisting.length, 0, `Refusing to alter an existing RLSOK installation:\n${preexisting.join('\n')}`);

  const lifecycleRoot = assertSafeLifecycleRoot(fs.mkdtempSync(path.join(os.tmpdir(), LIFECYCLE_PREFIX)));
  const installBase = path.join(lifecycleRoot, 'install');
  const profileDir = path.join(lifecycleRoot, 'profile');
  fs.mkdirSync(installBase, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  let installedExecutable = null;
  let uninstaller = null;
  let uninstalled = false;

  try {
    runExecutable(installer, ['/S', '/currentuser', `/D=${installBase}`], path.dirname(installer));
    installedExecutable = findInstalledExecutable(lifecycleRoot);
    assert(installedExecutable, `Silent installer did not create RLSOK.exe below ${lifecycleRoot}`);
    const installDir = path.dirname(installedExecutable);
    uninstaller = path.join(installDir, 'Uninstall RLSOK.exe');
    assert(fs.existsSync(uninstaller), 'Installed NSIS uninstaller is missing.');
    assert(queryRlsokRegistrations().some((entry) => entry.toLowerCase().includes(installDir.toLowerCase())), 'Per-user uninstall registration must point at the isolated installation.');

    runExecutable(installedExecutable, ['--prod', '--journey-smoke-test', `--user-data-dir=${profileDir}`], installDir);
    runExecutable(installedExecutable, ['--prod', '--smoke-test', '--offline-smoke-test', `--user-data-dir=${profileDir}`], installDir);

    const sentinel = path.join(profileDir, 'lifecycle-user-data-preserved.txt');
    fs.writeFileSync(sentinel, 'RealityWarden lifecycle preservation sentinel\n', 'utf8');
    runExecutable(installer, ['/S', '/currentuser', `/D=${installBase}`], path.dirname(installer));
    installedExecutable = findInstalledExecutable(lifecycleRoot);
    assert(installedExecutable, 'In-place reinstall removed the installed executable.');
    assert(fs.existsSync(sentinel), 'In-place reinstall must preserve user data.');
    runExecutable(installedExecutable, ['--prod', '--smoke-test', `--user-data-dir=${profileDir}`], path.dirname(installedExecutable));

    uninstaller = path.join(path.dirname(installedExecutable), 'Uninstall RLSOK.exe');
    // The uninstaller copies itself to a temporary process. Its working directory
    // must be outside INSTDIR or Windows can keep the otherwise-empty directory locked.
    runExecutable(uninstaller, ['/S', '/currentuser'], lifecycleRoot);
    waitForUninstallCompletion(path.dirname(installedExecutable));
    uninstalled = true;
    assert(fs.existsSync(sentinel), 'Uninstall must preserve user-created project and profile data by default.');

    const evidence = validateLifecycleEvidence({
      schema: 'realitywarden.windows-install-lifecycle',
      schema_version: 2,
      product: 'RealityWarden',
      release_version: packageJson.version,
      generated_at: generatedAt,
      platform: { os: process.platform, arch: process.arch },
      installer: { file: installerName, sha256: sha256File(installer) },
      installation: { scope: 'current-user', mode: 'silent-isolated-directory' },
      gates: {
        clean_install: 'passed',
        installed_first_run: 'passed',
        installed_core_journey: 'passed',
        offline_degradation: 'passed',
        in_place_reinstall: 'passed',
        uninstall: 'passed'
      },
      user_data_policy: { reinstall_preserved: true, uninstall_preserved: true },
      not_claimed: {
        previous_version_migration: 'project v1 and legacy autosave migration are tested; historical installer-to-installer migration is not assessed',
        code_signing: 'not assessed by this record',
        physical_hardware_acceptance: 'optional evidence; not assessed by this record'
      }
    }, packageJson.version, sha256File(installer));
    return writeLifecycleEvidence(root, evidence);
  } finally {
    if (!uninstalled && uninstaller && fs.existsSync(uninstaller)) {
      try {
        runExecutable(uninstaller, ['/S', '/currentuser'], lifecycleRoot);
      } catch {
        // The original lifecycle error remains authoritative; the temp root is retained for diagnosis.
      }
    }
    if (uninstalled && fs.existsSync(lifecycleRoot)) fs.rmSync(assertSafeLifecycleRoot(lifecycleRoot), { recursive: true, force: true });
  }
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = verifyWindowsInstallLifecycle(root);
  console.log('Windows install lifecycle verification passed.');
  console.log('- Clean per-user install, installed safe/blocked audit journey, explicit offline degradation, in-place reinstall, and uninstall passed.');
  console.log('- User project/profile data was preserved across reinstall and uninstall.');
  console.log(`- Evidence: ${path.basename(result.target)}`);
}

module.exports = {
  assertSafeLifecycleRoot,
  findInstalledExecutable,
  validateLifecycleEvidence,
  verifyWindowsInstallLifecycle,
  writeLifecycleEvidence
};

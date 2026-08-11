#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, resolve } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '..');
const npmCli = process.env.npm_execpath
  || require.resolve('npm/bin/npm-cli.js');
const temporary = mkdtempSync(resolve(tmpdir(), 'rlsok-pack-'));

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  });
}

try {
  const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', '--json']));
  const tarball = resolve(root, packed[0].filename);
  const installRoot = resolve(temporary, 'install');
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(
    resolve(installRoot, 'package.json'),
    '{"name":"rlsok-package-smoke","private":true}\n',
    'utf8'
  );
  run(process.execPath, [npmCli, 'install', '--ignore-scripts', tarball], installRoot);
  const packageRoot = resolve(
    installRoot,
    'node_modules',
    '@realitywarden',
    'rlsok'
  );
  const executable = resolve(packageRoot, 'dist', 'apps', 'cli', 'rlsok.js');
  run(process.execPath, [executable, '--help'], temporary);
  const setupHelp = run(process.execPath, [executable, 'setup', '--help'], temporary);
  if (!setupHelp.includes('Zero-to-Shadow') || !setupHelp.includes('--artifact')) {
    throw new Error('packaged_setup_help_unavailable');
  }
  const doctor = spawnSync(process.execPath, [executable, 'ros2', 'doctor'], {
    cwd: temporary,
    encoding: 'utf8',
    windowsHide: true
  });
  if (![0, 2].includes(doctor.status) || !doctor.stdout.includes('"rosAvailable"')) {
    throw new Error(`packaged_ros2_sidecar_unavailable:${doctor.stderr}`);
  }
  const release = resolve(
    packageRoot,
    'examples',
    'ros2-reference',
    'release.shadow.yaml'
  );
  const proposal = resolve(
    packageRoot,
    'examples',
    'standalone-shadow',
    'proposal.json'
  );
  run(process.execPath, [executable, 'check', release], temporary);
  const evidence = resolve(temporary, 'evidence.json');
  run(process.execPath, [executable, 'shadow', release, proposal, evidence], temporary);
  run(process.execPath, [executable, 'verify-evidence', evidence], temporary);
  const bytes = readFileSync(tarball);
  const digest = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  cpSync(tarball, resolve(root, 'artifacts', basename(tarball)));
  writeFileSync(
    resolve(root, 'artifacts', `${basename(tarball)}.sha256`),
    `${digest}  ${basename(tarball)}\n`,
    'utf8'
  );
  const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
  const manifest = {
    product: 'RLSOK runtime',
    version: packed[0].version,
    sourceCommit,
    package: basename(tarball),
    sizeBytes: bytes.length,
    sha256: digest,
    files: packed[0].files
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right))
  };
  writeFileSync(
    resolve(root, 'artifacts', `${basename(tarball)}.manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  rmSync(tarball);
  process.stdout.write(JSON.stringify({
    ...manifest,
    files: manifest.files.length,
    help: 'passed',
    setupHelp: 'passed',
    check: 'passed',
    standaloneShadow: 'passed',
    packagedRos2Sidecar: 'passed',
    repositoryRelativePathRequired: false
  }) + '\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

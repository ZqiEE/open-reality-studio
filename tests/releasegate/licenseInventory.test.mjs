import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLicenseInventory,
  generateLicenseInventory,
} = require('../../scripts/license-inventory.cjs');
const { generateSbomText } = require('../../scripts/generate-sbom.cjs');
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fixture = () => ({
  lock: {
    packages: {
      '': { name: '@realitywarden/rlsok', version: '1.4.5' },
      'node_modules/zod': { version: '3.25.76' },
      'node_modules/dev-only': { version: '1.0.0', dev: true },
      'node_modules/js-yaml': { version: '4.3.1' },
      'node_modules/js-yaml/node_modules/argparse': { version: '2.0.1' },
    },
  },
  installed: {
    'node_modules/zod': { name: 'zod', version: '3.25.76', license: 'MIT' },
    'node_modules/dev-only': { name: 'dev-only', version: '1.0.0', license: 'ISC' },
    'node_modules/js-yaml': { name: 'js-yaml', version: '4.3.1', license: 'MIT' },
    'node_modules/js-yaml/node_modules/argparse': {
      name: 'argparse',
      version: '2.0.1',
      license: 'Python-2.0',
    },
  },
});

test('includes only the deterministic shipped production dependency closure', () => {
  const { lock, installed } = fixture();
  const inventory = buildLicenseInventory(lock, (path) => installed[path]);
  assert.deepEqual(inventory, [
    { name: 'argparse', version: '2.0.1', license: 'Python-2.0' },
    { name: 'js-yaml', version: '4.3.1', license: 'MIT' },
    { name: 'zod', version: '3.25.76', license: 'MIT' },
  ]);

  const reversedLock = {
    packages: Object.fromEntries(Object.entries(lock.packages).reverse()),
  };
  assert.deepEqual(
    buildLicenseInventory(reversedLock, (path) => installed[path]),
    inventory,
  );
});

test('deduplicates the same shipped package version installed at multiple paths', () => {
  const { lock, installed } = fixture();
  lock.packages['node_modules/parent/node_modules/zod'] = { version: '3.25.76' };
  installed['node_modules/parent/node_modules/zod'] = installed['node_modules/zod'];
  const inventory = buildLicenseInventory(lock, (path) => installed[path]);
  assert.equal(inventory.filter(({ name }) => name === 'zod').length, 1);
});

test('rejects missing or conflicting shipped dependency licenses', () => {
  const { lock, installed } = fixture();
  delete installed['node_modules/zod'].license;
  assert.throws(
    () => buildLicenseInventory(lock, (path) => installed[path]),
    /dependency_license_missing:zod/,
  );

  installed['node_modules/zod'].license = 'MIT';
  lock.packages['node_modules/parent/node_modules/zod'] = { version: '3.25.76' };
  installed['node_modules/parent/node_modules/zod'] = {
    name: 'zod',
    version: '3.25.76',
    license: 'Apache-2.0',
  };
  assert.throws(
    () => buildLicenseInventory(lock, (path) => installed[path]),
    /dependency_license_conflict:zod@3\.25\.76/,
  );
});

test('real license inventory matches npm production-only CycloneDX components', () => {
  const inventory = generateLicenseInventory(repositoryRoot);
  const sbom = JSON.parse(generateSbomText({ cwd: repositoryRoot }));
  const licensePackages = inventory
    .map(({ name, version }) => `${name}@${version}`)
    .sort();
  const sbomPackages = sbom.components
    .map(({ name, version }) => `${name}@${version}`)
    .sort();

  assert.deepEqual(licensePackages, sbomPackages);
  assert.ok(inventory.every(({ license }) => Boolean(license)));
});

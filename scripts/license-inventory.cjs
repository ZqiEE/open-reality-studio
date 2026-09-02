#!/usr/bin/env node
'use strict';

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');

function buildLicenseInventory(lock, readInstalledPackage) {
  const inventoryByPackage = new Map();
  for (const [path, metadata] of Object.entries(lock.packages || {})) {
    if (!path.startsWith('node_modules/') || metadata.dev === true) continue;
    const packageJson = readInstalledPackage(path);
    if (!packageJson.name || !packageJson.version) {
      throw new Error(`dependency_identity_missing:${path}`);
    }
    const license = packageJson.license
      || packageJson.licenses
      || metadata.license;
    if (!license) {
      throw new Error(`dependency_license_missing:${packageJson.name}`);
    }
    const item = {
      name: packageJson.name,
      version: packageJson.version,
      license,
    };
    const key = `${item.name}\0${item.version}`;
    const existing = inventoryByPackage.get(key);
    if (existing && JSON.stringify(existing.license) !== JSON.stringify(license)) {
      throw new Error(`dependency_license_conflict:${item.name}@${item.version}`);
    }
    inventoryByPackage.set(key, item);
  }
  return [...inventoryByPackage.values()].sort((left, right) => (
    left.name.localeCompare(right.name)
    || left.version.localeCompare(right.version)
  ));
}

function generateLicenseInventory(rootDirectory = root) {
  const lock = JSON.parse(
    readFileSync(resolve(rootDirectory, 'package-lock.json'), 'utf8'),
  );
  return buildLicenseInventory(lock, (path) => JSON.parse(
    readFileSync(resolve(rootDirectory, path, 'package.json'), 'utf8'),
  ));
}

function main() {
  const inventory = generateLicenseInventory();
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(
    resolve(root, 'artifacts', 'licenses.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`licenses=${inventory.length}\n`);
}

if (require.main === module) main();

module.exports = {
  buildLicenseInventory,
  generateLicenseInventory,
};

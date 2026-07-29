#!/usr/bin/env node
'use strict';

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const inventory = [];
for (const [path, metadata] of Object.entries(lock.packages || {})) {
  if (!path.startsWith('node_modules/')) continue;
  const packageJson = JSON.parse(
    readFileSync(resolve(root, path, 'package.json'), 'utf8')
  );
  const license = packageJson.license
    || packageJson.licenses
    || metadata.license;
  if (!license) throw new Error(`dependency_license_missing:${packageJson.name}`);
  inventory.push({
    name: packageJson.name,
    version: packageJson.version,
    license
  });
}
inventory.sort((left, right) => left.name.localeCompare(right.name));
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
writeFileSync(
  resolve(root, 'artifacts', 'licenses.json'),
  `${JSON.stringify(inventory, null, 2)}\n`,
  'utf8'
);
process.stdout.write(`licenses=${inventory.length}\n`);

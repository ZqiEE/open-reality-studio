#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const output = resolve(root, 'artifacts', 'rlsok.cdx.json');
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const npmCli = process.env.npm_execpath
  || require.resolve('npm/bin/npm-cli.js');
const sbom = execFileSync(
  process.execPath,
  [npmCli, 'sbom', '--sbom-format', 'cyclonedx'],
  { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
);
JSON.parse(sbom);
writeFileSync(output, sbom, 'utf8');
process.stdout.write(`${output}\n`);

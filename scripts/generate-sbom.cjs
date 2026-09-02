#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const output = resolve(root, 'artifacts', 'rlsok.cdx.json');

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertUnique(values, errorCode, fingerprint = canonicalJson) {
  const seen = new Map();
  values.forEach((value, index) => {
    const key = fingerprint(value);
    if (seen.has(key)) {
      throw new Error(`${errorCode}:${key}:${seen.get(key)},${index}`);
    }
    seen.set(key, index);
  });
}

function collectBomRefs(value, path = '$', refs = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectBomRefs(entry, `${path}[${index}]`, refs));
    return refs;
  }
  if (value === null || typeof value !== 'object') return refs;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === 'bom-ref') {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error(`sbom_invalid_bom_ref:${entryPath}`);
      }
      refs.push({ ref: entry, path: entryPath });
    }
    collectBomRefs(entry, entryPath, refs);
  }
  return refs;
}

function assertValidSbom(document) {
  if (document?.bomFormat !== 'CycloneDX') {
    throw new Error('sbom_format_not_cyclonedx');
  }
  if (typeof document.specVersion !== 'string' || document.specVersion === '') {
    throw new Error('sbom_spec_version_missing');
  }

  const bomRefs = collectBomRefs(document);
  assertUnique(bomRefs, 'sbom_duplicate_bom_ref', ({ ref }) => ref);

  if (!Array.isArray(document.dependencies)) {
    throw new Error('sbom_dependencies_missing');
  }
  assertUnique(document.dependencies, 'sbom_duplicate_dependency_item');
  assertUnique(
    document.dependencies,
    'sbom_duplicate_dependency_ref',
    (dependency) => dependency?.ref,
  );
  for (const [index, dependency] of document.dependencies.entries()) {
    if (typeof dependency?.ref !== 'string' || dependency.ref.trim() === '') {
      throw new Error(`sbom_invalid_dependency_ref:${index}`);
    }
    const dependsOn = dependency.dependsOn ?? [];
    if (!Array.isArray(dependsOn)) {
      throw new Error(`sbom_invalid_dependency_targets:${dependency.ref}`);
    }
    assertUnique(
      dependsOn,
      `sbom_duplicate_dependency_target:${dependency.ref}`,
      (target) => target,
    );
  }
  return document;
}

function generateSbomText({
  execute = execFileSync,
  npmCli = process.env.npm_execpath || resolve(
    dirname(require.resolve('npm/package.json')),
    'bin',
    'npm-cli.js',
  ),
  cwd = root,
} = {}) {
  const sbom = execute(
    process.execPath,
    [npmCli, 'sbom', '--omit=dev', '--sbom-format', 'cyclonedx'],
    { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  assertValidSbom(JSON.parse(sbom));
  return sbom;
}

function main() {
  const sbom = generateSbomText();
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(output, sbom, 'utf8');
  process.stdout.write(`${output}\n`);
}

if (require.main === module) main();

module.exports = {
  assertValidSbom,
  generateSbomText,
};

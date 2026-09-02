import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertValidSbom,
  generateSbomText,
} = require('../../scripts/generate-sbom.cjs');

const validSbom = () => ({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: {
    component: {
      'bom-ref': '@realitywarden/rlsok@1.4.5',
      type: 'library',
      name: 'rlsok',
      version: '1.4.5',
    },
  },
  components: [
    {
      'bom-ref': 'pkg:npm/js-yaml@4.3.1',
      type: 'library',
      name: 'js-yaml',
      version: '4.3.1',
    },
  ],
  dependencies: [
    {
      ref: '@realitywarden/rlsok@1.4.5',
      dependsOn: ['pkg:npm/js-yaml@4.3.1'],
    },
    { ref: 'pkg:npm/js-yaml@4.3.1', dependsOn: [] },
  ],
});

test('validates a CycloneDX runtime dependency graph', () => {
  assert.equal(assertValidSbom(validSbom()).bomFormat, 'CycloneDX');
});

test('rejects repeated bom-ref values even when component paths differ', () => {
  const sbom = validSbom();
  sbom.components = [
    {
      'bom-ref': 'semver@6.3.1',
      properties: [{ name: 'cdx:npm:package:path', value: 'node_modules/a/semver' }],
    },
    {
      'bom-ref': 'semver@6.3.1',
      properties: [{ name: 'cdx:npm:package:path', value: 'node_modules/b/semver' }],
    },
  ];
  assert.throws(() => assertValidSbom(sbom), /sbom_duplicate_bom_ref/);
});

test('rejects structurally duplicate dependency items', () => {
  const sbom = validSbom();
  sbom.dependencies.push({ dependsOn: [], ref: 'pkg:npm/js-yaml@4.3.1' });
  assert.throws(() => assertValidSbom(sbom), /sbom_duplicate_dependency_item/);
});

test('rejects repeated dependency refs with different target sets', () => {
  const sbom = validSbom();
  sbom.dependencies.push({
    ref: 'pkg:npm/js-yaml@4.3.1',
    dependsOn: ['another-component'],
  });
  assert.throws(() => assertValidSbom(sbom), /sbom_duplicate_dependency_ref/);
});

test('rejects duplicate targets within a dependency item', () => {
  const sbom = validSbom();
  sbom.dependencies[0].dependsOn.push('pkg:npm/js-yaml@4.3.1');
  assert.throws(() => assertValidSbom(sbom), /sbom_duplicate_dependency_target/);
});

test('generates a production-only SBOM before validating it', () => {
  const calls = [];
  const expected = `${JSON.stringify(validSbom())}\n`;
  const actual = generateSbomText({
    npmCli: 'npm-cli-for-test.js',
    cwd: 'repository-root-for-test',
    execute(command, args, options) {
      calls.push({ command, args, options });
      return expected;
    },
  });

  assert.equal(actual, expected);
  assert.deepEqual(calls, [{
    command: process.execPath,
    args: [
      'npm-cli-for-test.js',
      'sbom',
      '--omit=dev',
      '--sbom-format',
      'cyclonedx',
    ],
    options: {
      cwd: 'repository-root-for-test',
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    },
  }]);
});

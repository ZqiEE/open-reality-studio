'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[A-Fa-f0-9]{64}$/;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} contains missing or unknown fields`);
}

function parseIso(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a canonical ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp`);
  return parsed;
}

function npmCliPath() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(bundled)) throw new Error('npm CLI could not be located for supply-chain evidence');
  return bundled;
}

function defaultRunNpm(args, cwd) {
  return spawnSync(process.execPath, [npmCliPath(), ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function parseCommandJson(result, label) {
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (typeof result.stdout !== 'string' || !result.stdout.trim()) throw new Error(`${label} returned no JSON; no fallback was used`);
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function buildSupplyChainArtifacts(root, options = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) throw new Error('package-lock.json is required for supply-chain evidence');
  const runNpm = options.runNpm ?? defaultRunNpm;
  const auditResult = runNpm(['audit', '--json'], root);
  const audit = parseCommandJson(auditResult, 'npm audit');
  const counts = audit?.metadata?.vulnerabilities;
  if (!counts || !Number.isInteger(counts.total) || ['info', 'low', 'moderate', 'high', 'critical'].some((key) => !Number.isInteger(counts[key]))) throw new Error('npm audit vulnerability counts are incomplete');
  if (counts.total !== 0 || auditResult.status !== 0) throw new Error(`npm audit found ${counts.total} known vulnerability record(s); supply-chain release evidence refused`);
  const sbomResult = runNpm(['sbom', '--omit', 'dev', '--sbom-format', 'cyclonedx', '--sbom-type', 'application'], root);
  if (sbomResult.status !== 0) throw new Error(`npm SBOM generation failed: ${String(sbomResult.stderr ?? '').trim() || 'unknown error'}`);
  const sbom = parseCommandJson(sbomResult, 'npm SBOM');
  if (sbom.bomFormat !== 'CycloneDX' || typeof sbom.specVersion !== 'string' || sbom.metadata?.component?.type !== 'application' || sbom.metadata?.component?.name !== packageJson.name || sbom.metadata?.component?.version !== packageJson.version) throw new Error('CycloneDX SBOM root component does not match package metadata');
  if (!Array.isArray(sbom.components) || !Array.isArray(sbom.dependencies)) throw new Error('CycloneDX SBOM component/dependency inventory is incomplete');
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  parseIso(generatedAt, 'supply-chain generated_at');
  const sbomName = `RLSOK-${packageJson.version}-SBOM.cdx.json`;
  const sbomBytes = `${JSON.stringify(sbom, null, 2)}\n`;
  const lockSha256 = sha256Bytes(fs.readFileSync(lockPath));
  const evidence = {
    schema: 'realitywarden.supply-chain-evidence',
    schema_version: 1,
    product: 'RealityWarden',
    release_version: packageJson.version,
    generated_at: generatedAt,
    no_audit_fallback: true,
    package_lock: { file: 'package-lock.json', sha256: lockSha256 },
    audit: {
      command: 'npm audit --json',
      vulnerabilities: { info: counts.info, low: counts.low, moderate: counts.moderate, high: counts.high, critical: counts.critical, total: counts.total },
      dependency_total: audit.metadata?.dependencies?.total ?? null
    },
    sbom: { file: sbomName, sha256: sha256Bytes(sbomBytes), format: 'CycloneDX', spec_version: sbom.specVersion, component_count: sbom.components.length, dependency_node_count: sbom.dependencies.length, scope: 'production_dependencies' }
  };
  return { evidence, sbom, sbomBytes };
}

function validateSupplyChainEvidence(evidence, input) {
  exactKeys(evidence, ['schema', 'schema_version', 'product', 'release_version', 'generated_at', 'no_audit_fallback', 'package_lock', 'audit', 'sbom'], 'Supply-chain evidence');
  if (evidence.schema !== 'realitywarden.supply-chain-evidence' || evidence.schema_version !== 1 || evidence.product !== 'RealityWarden' || evidence.release_version !== input.version || evidence.no_audit_fallback !== true) throw new Error('Invalid supply-chain evidence identity or fallback semantics');
  exactKeys(evidence.package_lock, ['file', 'sha256'], 'Supply-chain lockfile evidence');
  if (evidence.package_lock.file !== 'package-lock.json' || evidence.package_lock.sha256.toUpperCase() !== input.packageLockSha256.toUpperCase()) throw new Error('Supply-chain evidence does not match the current package-lock.json');
  exactKeys(evidence.audit, ['command', 'vulnerabilities', 'dependency_total'], 'Supply-chain audit evidence');
  exactKeys(evidence.audit.vulnerabilities, ['info', 'low', 'moderate', 'high', 'critical', 'total'], 'Supply-chain vulnerability counts');
  if (evidence.audit.command !== 'npm audit --json' || Object.values(evidence.audit.vulnerabilities).some((value) => value !== 0)) throw new Error('Supply-chain evidence contains a known vulnerability or non-authoritative audit command');
  exactKeys(evidence.sbom, ['file', 'sha256', 'format', 'spec_version', 'component_count', 'dependency_node_count', 'scope'], 'Supply-chain SBOM evidence');
  if (evidence.sbom.file !== input.sbomFile || !SHA256.test(evidence.sbom.sha256) || evidence.sbom.sha256.toUpperCase() !== input.sbomSha256.toUpperCase() || evidence.sbom.format !== 'CycloneDX' || evidence.sbom.scope !== 'production_dependencies' || !Number.isInteger(evidence.sbom.component_count) || evidence.sbom.component_count < 1) throw new Error('Supply-chain SBOM evidence is invalid or does not match exact SBOM bytes');
  const generatedAt = parseIso(evidence.generated_at, 'Supply-chain generated_at');
  const now = parseIso(input.now, 'Supply-chain verification clock');
  if (generatedAt > now + 5 * 60_000 || now - generatedAt > MAX_EVIDENCE_AGE_MS) throw new Error('Supply-chain evidence is stale or implausibly in the future');
  return evidence;
}

function writeSupplyChainEvidence(root, options = {}) {
  const built = buildSupplyChainArtifacts(root, options);
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const sbomPath = path.join(releaseDir, built.evidence.sbom.file);
  const evidenceName = `RLSOK-${built.evidence.release_version}-Supply-Chain-Evidence.json`;
  const evidencePath = path.join(releaseDir, evidenceName);
  const outputs = [sbomPath, `${sbomPath}.sha256`, evidencePath, `${evidencePath}.sha256`];
  if (outputs.some((file) => fs.existsSync(file))) throw new Error('supply-chain output already exists; overwrite is refused');
  const evidenceBytes = `${JSON.stringify(built.evidence, null, 2)}\n`;
  fs.writeFileSync(sbomPath, built.sbomBytes, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(`${sbomPath}.sha256`, `${built.evidence.sbom.sha256}  ${path.basename(sbomPath)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(evidencePath, evidenceBytes, { encoding: 'utf8', flag: 'wx' });
  const evidenceSha256 = sha256Bytes(evidenceBytes);
  fs.writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${evidenceName}\n`, { encoding: 'utf8', flag: 'wx' });
  return { evidence: built.evidence, evidencePath, evidenceSha256, sbomPath };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const result = writeSupplyChainEvidence(root);
    console.log(`Supply-chain evidence passed for RealityWarden ${result.evidence.release_version}.`);
    console.log(`- npm audit known vulnerabilities: ${result.evidence.audit.vulnerabilities.total}`);
    console.log(`- CycloneDX production components: ${result.evidence.sbom.component_count}`);
    console.log(`- Evidence: ${path.basename(result.evidencePath)}`);
  } catch (error) {
    console.error(`Supply-chain evidence refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { buildSupplyChainArtifacts, validateSupplyChainEvidence, writeSupplyChainEvidence };

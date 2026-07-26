'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function inspectAuthenticode(filePath) {
  if (process.platform !== 'win32') throw new Error('Authenticode verification requires Windows.');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Authenticode target is missing: ${filePath}`);
  const script = [
    "$ErrorActionPreference='Stop'",
    '$signature=Get-AuthenticodeSignature -LiteralPath $env:RW_SIGNATURE_TARGET',
    '$signer=$signature.SignerCertificate',
    '$timestamp=$signature.TimeStamperCertificate',
    '[pscustomobject]@{status=$signature.Status.ToString();status_message=$signature.StatusMessage;signer_subject=if($signer){$signer.Subject}else{$null};signer_issuer=if($signer){$signer.Issuer}else{$null};signer_thumbprint=if($signer){$signer.Thumbprint}else{$null};signer_not_before=if($signer){$signer.NotBefore.ToUniversalTime().ToString("o")}else{$null};signer_not_after=if($signer){$signer.NotAfter.ToUniversalTime().ToString("o")}else{$null};timestamp_subject=if($timestamp){$timestamp.Subject}else{$null};timestamp_thumbprint=if($timestamp){$timestamp.Thumbprint}else{$null}} | ConvertTo-Json -Compress'
  ].join(';');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, RW_SIGNATURE_TARGET: path.resolve(filePath) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).replace(/^\uFEFF/, '').trim();
  let parsed;
  try { parsed = JSON.parse(output); }
  catch { throw new Error(`Authenticode inspection returned invalid JSON for ${path.basename(filePath)}`); }
  if (parsed.status !== 'Valid') throw new Error(`Authenticode signature is not Valid for ${path.basename(filePath)}: ${parsed.status ?? 'unknown'} ${parsed.status_message ?? ''}`.trim());
  if (typeof parsed.signer_subject !== 'string' || !parsed.signer_subject.trim()) throw new Error(`Authenticode signer identity is missing for ${path.basename(filePath)}`);
  if (typeof parsed.signer_thumbprint !== 'string' || !/^[A-Fa-f0-9]{40,128}$/.test(parsed.signer_thumbprint)) throw new Error(`Authenticode signer thumbprint is invalid for ${path.basename(filePath)}`);
  if (typeof parsed.timestamp_subject !== 'string' || !parsed.timestamp_subject.trim()) throw new Error(`Authenticode timestamp is missing for ${path.basename(filePath)}`);
  if (typeof parsed.timestamp_thumbprint !== 'string' || !/^[A-Fa-f0-9]{40,128}$/.test(parsed.timestamp_thumbprint)) throw new Error(`Authenticode timestamp thumbprint is invalid for ${path.basename(filePath)}`);
  return {
    status: 'Valid',
    status_message: String(parsed.status_message ?? ''),
    signer: {
      subject: parsed.signer_subject,
      issuer: String(parsed.signer_issuer ?? ''),
      thumbprint: parsed.signer_thumbprint.toUpperCase(),
      not_before: String(parsed.signer_not_before ?? ''),
      not_after: String(parsed.signer_not_after ?? '')
    },
    timestamp: {
      subject: parsed.timestamp_subject,
      thumbprint: parsed.timestamp_thumbprint.toUpperCase()
    }
  };
}

function buildAuthenticodeEvidence(root, version, generatedAt = new Date().toISOString()) {
  const releaseDir = path.join(root, 'release');
  const targets = [
    { file: 'win-unpacked/RLSOK.exe', absolute: path.join(releaseDir, 'win-unpacked', 'RLSOK.exe') },
    { file: `RLSOK-${version}-Setup.exe`, absolute: path.join(releaseDir, `RLSOK-${version}-Setup.exe`) }
  ];
  return {
    schema: 'realitywarden.windows-authenticode-evidence',
    schema_version: 1,
    product: 'RealityWarden',
    release_version: version,
    generated_at: generatedAt,
    artifacts: targets.map((target) => ({
      file: target.file,
      size_bytes: fs.statSync(target.absolute).size,
      sha256: sha256File(target.absolute),
      ...inspectAuthenticode(target.absolute)
    }))
  };
}

function validateAuthenticodeEvidence(evidence, version, expectedDigests) {
  if (evidence?.schema !== 'realitywarden.windows-authenticode-evidence' || evidence?.schema_version !== 1 || evidence?.release_version !== version) throw new Error('Invalid Windows Authenticode evidence schema or version.');
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length !== 2) throw new Error('Windows Authenticode evidence must contain exactly two artifacts.');
  const expectedFiles = new Set(Object.keys(expectedDigests));
  for (const artifact of evidence.artifacts) {
    if (!expectedFiles.delete(artifact?.file)) throw new Error(`Unexpected or duplicate Authenticode artifact: ${artifact?.file ?? 'missing'}`);
    if (artifact.status !== 'Valid') throw new Error(`Authenticode artifact is not Valid: ${artifact.file}`);
    if (artifact.sha256 !== expectedDigests[artifact.file]) throw new Error(`Authenticode artifact digest mismatch: ${artifact.file}`);
    if (typeof artifact.signer?.subject !== 'string' || !artifact.signer.subject.trim() || !/^[A-F0-9]{40,128}$/.test(artifact.signer?.thumbprint ?? '')) throw new Error(`Authenticode signer evidence is incomplete: ${artifact.file}`);
    if (typeof artifact.timestamp?.subject !== 'string' || !artifact.timestamp.subject.trim() || !/^[A-F0-9]{40,128}$/.test(artifact.timestamp?.thumbprint ?? '')) throw new Error(`Authenticode timestamp evidence is incomplete: ${artifact.file}`);
  }
  if (expectedFiles.size > 0) throw new Error(`Authenticode evidence is missing: ${Array.from(expectedFiles).join(', ')}`);
  return evidence;
}

function writeAuthenticodeEvidence(root, version) {
  const evidence = buildAuthenticodeEvidence(root, version);
  const releaseDir = path.join(root, 'release');
  const name = `RLSOK-${version}-Authenticode-Evidence.json`;
  const evidencePath = path.join(releaseDir, name);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(evidencePath, serialized, 'utf8');
  const digest = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
  fs.writeFileSync(`${evidencePath}.sha256`, `${digest}  ${name}\n`, 'utf8');
  return { evidence, evidencePath, digest };
}

module.exports = { buildAuthenticodeEvidence, inspectAuthenticode, sha256File, validateAuthenticodeEvidence, writeAuthenticodeEvidence };

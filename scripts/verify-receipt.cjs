#!/usr/bin/env node
/**
 * Standalone RealityWarden audit-receipt verifier.
 *
 * Usage:
 *   node scripts/verify-receipt.cjs <file.receipt.json>
 *   npm run receipt:verify -- <file.receipt.json>
 *
 * This tool is deliberately dependency-free and independent of the app's
 * TypeScript build, so a customer, insurer, or auditor can verify a receipt
 * on any machine with Node.js — without trusting or even installing
 * RealityWarden. It re-implements the documented canonicalization
 * (docs/RECEIPT_FORMAT.md) and recomputes the SHA-256 content hash.
 *
 * Exit codes: 0 = VALID, 1 = INVALID or unreadable.
 */

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function fail(message) {
  console.error(`INVALID: ${message}`);
  process.exit(1);
}

/** Canonical serialization — must match lib/receipt/AuditReceipt.ts exactly:
 *  object keys sorted lexicographically at every depth, arrays in original
 *  order, undefined members omitted, non-finite numbers rejected. */
function serialize(value) {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical_stringify_non_finite_number');
    return JSON.stringify(value);
  }
  if (kind === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item === undefined ? null : item)).join(',')}]`;
  }
  if (kind === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
  }
  throw new Error(`canonical_stringify_unsupported_type:${kind}`);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/verify-receipt.cjs <file.receipt.json>');
    process.exit(1);
  }

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read/parse ${file}: ${error.message}`);
    return;
  }

  if (receipt.schema !== 'realitywarden.receipt/v1') {
    fail(`unsupported schema: ${String(receipt.schema)}`);
  }
  if (!receipt.integrity || receipt.integrity.algorithm !== 'sha256' || typeof receipt.integrity.contentHash !== 'string') {
    fail('missing or malformed integrity block');
  }
  if (!Array.isArray(receipt.entries)) {
    fail('entries must be an array');
  }

  // Evidence consistency: hardwareSignalSent must agree with the precise state.
  for (let i = 0; i < receipt.entries.length; i += 1) {
    const entry = receipt.entries[i];
    const expected = entry.hardwareSignalState !== 'not_sent';
    if (entry.hardwareSignalSent !== expected) {
      fail(`inconsistent hardware evidence at entry ${i} (${entry.id ?? 'no id'})`);
    }
  }

  // Recompute the content hash over the canonical body (all fields except integrity).
  const body = {};
  for (const key of Object.keys(receipt)) {
    if (key !== 'integrity') body[key] = receipt[key];
  }
  let recomputed;
  try {
    recomputed = crypto.createHash('sha256').update(serialize(body), 'utf8').digest('hex');
  } catch (error) {
    fail(`canonicalization failed: ${error.message}`);
    return;
  }
  if (recomputed !== receipt.integrity.contentHash) {
    fail(`content hash mismatch\n  claimed:    ${receipt.integrity.contentHash}\n  recomputed: ${recomputed}\n  The receipt was modified after export.`);
  }

  const s = receipt.summary ?? {};
  const byState = s.byHardwareSignalState ?? {};
  console.log('VALID: content hash verified, evidence internally consistent.');
  console.log(`- schema: ${receipt.schema}`);
  console.log(`- product: ${receipt.product} ${receipt.meta ? `v${receipt.meta.appVersion}` : ''}`);
  console.log(`- generated: ${receipt.generatedAt}`);
  console.log(`- time range: ${receipt.timeRange?.from ?? 'n/a'} -> ${receipt.timeRange?.to ?? 'n/a'}`);
  console.log(`- entries: ${s.totalEntries ?? receipt.entries.length}`);
  console.log(`- hardware signal evidence: not_sent=${byState.not_sent ?? 0}, attempted_unconfirmed=${byState.attempted_unconfirmed ?? 0}, device_acknowledged=${byState.device_acknowledged ?? 0}`);
  console.log(`- sha256: ${receipt.integrity.contentHash}`);
  console.log('Note: the hash proves the receipt is unmodified since export (tamper-evident). It is not a cryptographic signature and does not by itself prove who produced it.');
  process.exit(0);
}

main();

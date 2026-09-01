import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalJson } from "../core/evidence";

export interface ProposalReplayIdentity {
  releaseId: string;
  executablePolicyHash: string;
  deviceId: string;
  proposerIdentity: string;
  proposalId: string;
}

export type ProposalReplayClaim =
  | "claimed"
  | "duplicate"
  | "capacity_exceeded"
  | "unavailable";

export interface ProposalReplayRegistryReadiness {
  ready: boolean;
  reason: "ready" | "capacity_exceeded" | "unavailable";
  remainingClaims: number;
}

export interface ProposalReplayRegistry {
  claim(identity: ProposalReplayIdentity): ProposalReplayClaim;
}

const REGISTRY_FILE = ".registry";
const STAGING_DIRECTORY = ".staging";
const REGISTRY_SCHEMA = "rlsok.io/proposal-replay-registry/v1";
const CLAIM_SCHEMA = "rlsok.io/proposal-replay-claim/v1";
const CLAIM_NAME = /^([a-f0-9]{64})\.claim$/;

interface RegistryMetadata {
  schema: typeof REGISTRY_SCHEMA;
  maximumClaims: number;
}

interface StoredClaim {
  schema: typeof CLAIM_SCHEMA;
  identityHash: string;
  identity: ProposalReplayIdentity;
}

interface InspectedClaim {
  record: StoredClaim;
  bytes: string;
}

function identityBytes(identity: ProposalReplayIdentity): string {
  return `${canonicalJson(identity)}\n`;
}

function identityHash(identity: ProposalReplayIdentity): string {
  return createHash("sha256").update(identityBytes(identity)).digest("hex");
}

function capacity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("proposal_replay_registry_capacity_invalid");
  }
  return value;
}

function validIdentity(identity: unknown): identity is ProposalReplayIdentity {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const candidate = identity as Partial<ProposalReplayIdentity>;
  return (
    Object.keys(candidate).sort().join(",")
      === "deviceId,executablePolicyHash,proposalId,proposerIdentity,releaseId"
    && typeof candidate.releaseId === "string"
    && candidate.releaseId.length >= 1
    && candidate.releaseId.length <= 256
    && typeof candidate.executablePolicyHash === "string"
    && /^[a-f0-9]{64}$/.test(candidate.executablePolicyHash)
    && typeof candidate.deviceId === "string"
    && candidate.deviceId.length >= 1
    && candidate.deviceId.length <= 256
    && typeof candidate.proposerIdentity === "string"
    && candidate.proposerIdentity.length >= 1
    && candidate.proposerIdentity.length <= 256
    && typeof candidate.proposalId === "string"
    && candidate.proposalId.length >= 1
    && candidate.proposalId.length <= 128
  );
}

function metadataBytes(maximumClaims: number): string {
  return `${canonicalJson({ schema: REGISTRY_SCHEMA, maximumClaims })}\n`;
}

function storedClaim(identity: ProposalReplayIdentity): StoredClaim {
  return {
    schema: CLAIM_SCHEMA,
    identityHash: identityHash(identity),
    identity,
  };
}

function storedClaimBytes(identity: ProposalReplayIdentity): string {
  return `${canonicalJson(storedClaim(identity))}\n`;
}

function slotName(index: number): string {
  return `${index.toString(16).padStart(64, "0")}.claim`;
}

function slotIndex(name: string, maximumClaims: number): number | null {
  const match = CLAIM_NAME.exec(name);
  if (!match) return null;
  const value = BigInt(`0x${match[1]}`);
  return value < BigInt(maximumClaims) ? Number(value) : null;
}

function startingSlot(digest: string, maximumClaims: number): number {
  return Number(BigInt(`0x${digest}`) % BigInt(maximumClaims));
}

export class InMemoryProposalReplayRegistry implements ProposalReplayRegistry {
  private readonly claims = new Map<string, string>();
  private readonly maximumClaims: number;

  constructor(maximumClaims = 65_536) {
    this.maximumClaims = capacity(maximumClaims);
  }

  claim(identity: ProposalReplayIdentity): ProposalReplayClaim {
    if (!validIdentity(identity)) return "unavailable";
    let digest: string;
    try {
      digest = identityHash(identity);
    } catch {
      return "unavailable";
    }
    const expected = identityBytes(identity);
    const existing = this.claims.get(digest);
    if (existing !== undefined) return existing === expected ? "duplicate" : "unavailable";
    if (this.claims.size >= this.maximumClaims) return "capacity_exceeded";
    this.claims.set(digest, expected);
    return "claimed";
  }
}

/**
 * Crash-persistent, cross-process proposal claims.
 *
 * The registry is a fixed-size open-addressed slot table. Each slot has one
 * deterministic pathname. A fully written and synchronized staging inode is
 * hard-linked into a slot without replacement, so different processes cannot
 * exceed the configured capacity and no crash-stale mutex is needed. Orphaned
 * staging files are non-authoritative and recoverable; once any slot exists,
 * even a later-torn/corrupt slot remains fail-closed and is never deleted.
 */
export class FileProposalReplayRegistry implements ProposalReplayRegistry {
  private readonly directory: string;
  private readonly stagingDirectory: string;
  private readonly maximumClaims: number;

  constructor(directory: string, maximumClaims = 65_536) {
    this.directory = resolve(directory);
    this.stagingDirectory = resolve(this.directory, STAGING_DIRECTORY);
    this.maximumClaims = capacity(maximumClaims);
  }

  private assertDirectory(path: string, error: string): void {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(error);
    }
  }

  private assertDirectoryChain(path: string, error: string): void {
    let cursor = resolve(path);
    while (true) {
      this.assertDirectory(cursor, error);
      const parent = dirname(cursor);
      if (parent === cursor) return;
      cursor = parent;
    }
  }

  private prepareDirectory(): void {
    const missing: string[] = [];
    let cursor = this.directory;
    while (true) {
      try {
        this.assertDirectory(
          cursor,
          "proposal_replay_registry_path_must_be_non_symlink_directory",
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(cursor);
        if (parent === cursor) throw error;
        missing.push(cursor);
        cursor = parent;
      }
    }
    this.assertDirectoryChain(
      cursor,
      "proposal_replay_registry_path_must_be_non_symlink_directory",
    );
    for (const path of missing.reverse()) {
      try {
        mkdirSync(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      this.assertDirectory(
        path,
        "proposal_replay_registry_path_must_be_non_symlink_directory",
      );
      this.synchronizeDirectory(dirname(path));
    }
    this.assertDirectory(
      this.directory,
      "proposal_replay_registry_must_be_non_symlink_directory",
    );
    this.assertDirectoryChain(
      this.directory,
      "proposal_replay_registry_path_must_be_non_symlink_directory",
    );
    this.synchronizeDirectoryEntryChain(this.directory);
    if (process.platform !== "win32") {
      chmodSync(this.directory, 0o700);
      if ((lstatSync(this.directory).mode & 0o077) !== 0) {
        throw new Error("proposal_replay_registry_permissions_invalid");
      }
    }
    try {
      mkdirSync(this.stagingDirectory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.assertDirectory(
      this.stagingDirectory,
      "proposal_replay_registry_staging_must_be_non_symlink_directory",
    );
    this.synchronizeDirectory(this.directory);
    if (process.platform !== "win32") {
      chmodSync(this.stagingDirectory, 0o700);
      if ((lstatSync(this.stagingDirectory).mode & 0o077) !== 0) {
        throw new Error("proposal_replay_registry_staging_permissions_invalid");
      }
    }
  }

  private synchronizeDirectory(path: string): void {
    if (process.platform === "win32") return;
    const descriptor = openSync(path, constants.O_RDONLY);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  private synchronizeDirectoryEntryChain(path: string): void {
    if (process.platform === "win32") return;
    let cursor = resolve(path);
    while (true) {
      const parent = dirname(cursor);
      if (parent === cursor) return;
      this.synchronizeDirectory(parent);
      cursor = parent;
    }
  }

  private containsOnlyStagingDirectory(): boolean {
    let directory: ReturnType<typeof opendirSync> | undefined;
    try {
      directory = opendirSync(this.directory);
      for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
        if (entry.name !== STAGING_DIRECTORY || !entry.isDirectory()) return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      directory?.closeSync();
    }
  }

  private publishImmutable(
    path: string,
    bytes: string,
  ): "published" | "exists" | "unavailable" {
    const stagePath = resolve(this.stagingDirectory, `.stage-${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    let result: "published" | "exists" | "unavailable" = "unavailable";
    try {
      descriptor = openSync(
        stagePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, bytes, "utf8");
      fsyncSync(descriptor);
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size !== Buffer.byteLength(bytes)) return "unavailable";
      closeSync(descriptor);
      descriptor = undefined;
      if (process.platform !== "win32") chmodSync(stagePath, 0o600);
      try {
        linkSync(stagePath, path);
        result = "published";
      } catch (error) {
        result = (error as NodeJS.ErrnoException).code === "EEXIST"
          ? "exists"
          : "unavailable";
      }
    } catch {
      result = "unavailable";
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(stagePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") result = "unavailable";
      }
    }
    if (result === "published") {
      try {
        this.synchronizeDirectory(this.directory);
      } catch {
        return "unavailable";
      }
    }
    return result;
  }

  private readRegularFile(
    path: string,
    maximumBytes: number,
  ): "absent" | "unavailable" | string {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
        return "unavailable";
      }
      const bytes = Buffer.allocUnsafe(stat.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
        if (count === 0) break;
        offset += count;
      }
      return offset === bytes.byteLength ? bytes.toString("utf8") : "unavailable";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unavailable";
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private inspectMetadata(): "absent" | "unavailable" | "valid" {
    const bytes = this.readRegularFile(resolve(this.directory, REGISTRY_FILE), 1_024);
    if (bytes === "absent" || bytes === "unavailable") return bytes;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes);
    } catch {
      return "unavailable";
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unavailable";
    const candidate = parsed as Partial<RegistryMetadata>;
    if (
      Object.keys(candidate).sort().join(",") !== "maximumClaims,schema"
      || candidate.schema !== REGISTRY_SCHEMA
      || candidate.maximumClaims !== this.maximumClaims
      || bytes !== metadataBytes(this.maximumClaims)
    ) {
      return "unavailable";
    }
    return "valid";
  }

  private ensureMetadata(): boolean {
    const existing = this.inspectMetadata();
    if (existing === "valid") return true;
    if (existing === "unavailable") return false;
    if (!this.containsOnlyStagingDirectory()) {
      return this.inspectMetadata() === "valid";
    }
    const path = resolve(this.directory, REGISTRY_FILE);
    const publication = this.publishImmutable(path, metadataBytes(this.maximumClaims));
    if (publication === "unavailable") return false;
    if (this.inspectMetadata() !== "valid") return false;
    return true;
  }

  private inspectClaim(path: string): "absent" | "unavailable" | InspectedClaim {
    const bytes = this.readRegularFile(path, 16 * 1024);
    if (bytes === "absent" || bytes === "unavailable") return bytes;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes);
    } catch {
      return "unavailable";
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unavailable";
    const candidate = parsed as Partial<StoredClaim>;
    if (
      Object.keys(candidate).sort().join(",") !== "identity,identityHash,schema"
      || candidate.schema !== CLAIM_SCHEMA
      || typeof candidate.identityHash !== "string"
      || !/^[a-f0-9]{64}$/.test(candidate.identityHash)
      || !validIdentity(candidate.identity)
    ) {
      return "unavailable";
    }
    const record = candidate as StoredClaim;
    if (
      record.identityHash !== identityHash(record.identity)
      || bytes !== `${canonicalJson(record)}\n`
    ) {
      return "unavailable";
    }
    return { record, bytes };
  }

  private publicationSupported(): boolean {
    const source = resolve(this.stagingDirectory, `.probe-${randomUUID()}.source`);
    const destination = resolve(
      this.stagingDirectory,
      `.probe-${randomUUID()}.link`,
    );
    let descriptor: number | undefined;
    let supported = false;
    let cleanupSucceeded = true;
    try {
      descriptor = openSync(
        source,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, "probe\n", "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      linkSync(source, destination);
      const linked = lstatSync(destination);
      supported = linked.isFile() && !linked.isSymbolicLink();
    } catch {
      supported = false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      for (const path of [destination, source]) {
        try {
          unlinkSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            cleanupSucceeded = false;
          }
        }
      }
      try {
        this.synchronizeDirectory(this.stagingDirectory);
      } catch {
        cleanupSucceeded = false;
      }
    }
    return supported && cleanupSucceeded;
  }

  checkReady(): ProposalReplayRegistryReadiness {
    try {
      this.prepareDirectory();
      if (!this.ensureMetadata() || !this.publicationSupported()) {
        return { ready: false, reason: "unavailable", remainingClaims: 0 };
      }
      const occupied = new Set<number>();
      let directory: ReturnType<typeof opendirSync> | undefined;
      try {
        directory = opendirSync(this.directory);
        let entryCount = 0;
        for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
          entryCount += 1;
          if (entryCount > this.maximumClaims + 2) {
            return { ready: false, reason: "unavailable", remainingClaims: 0 };
          }
          if (entry.name === REGISTRY_FILE) {
            if (!entry.isFile()) {
              return { ready: false, reason: "unavailable", remainingClaims: 0 };
            }
            continue;
          }
          if (entry.name === STAGING_DIRECTORY) {
            if (!entry.isDirectory()) {
              return { ready: false, reason: "unavailable", remainingClaims: 0 };
            }
            continue;
          }
          const index = slotIndex(entry.name, this.maximumClaims);
          if (index === null || !entry.isFile() || occupied.has(index)) {
            return { ready: false, reason: "unavailable", remainingClaims: 0 };
          }
          const observed = this.inspectClaim(resolve(this.directory, entry.name));
          if (observed === "absent" || observed === "unavailable") {
            return { ready: false, reason: "unavailable", remainingClaims: 0 };
          }
          occupied.add(index);
        }
      } finally {
        directory?.closeSync();
      }
      const remainingClaims = this.maximumClaims - occupied.size;
      return remainingClaims > 0
        ? { ready: true, reason: "ready", remainingClaims }
        : { ready: false, reason: "capacity_exceeded", remainingClaims: 0 };
    } catch {
      return { ready: false, reason: "unavailable", remainingClaims: 0 };
    }
  }

  claim(identity: ProposalReplayIdentity): ProposalReplayClaim {
    try {
      if (!validIdentity(identity)) return "unavailable";
      this.prepareDirectory();
      if (!this.ensureMetadata()) return "unavailable";
      const expected = storedClaimBytes(identity);
      if (Buffer.byteLength(expected) > 16 * 1024) return "unavailable";
      const digest = identityHash(identity);
      const occupied = new Set<number>();
      let directory: ReturnType<typeof opendirSync> | undefined;
      try {
        directory = opendirSync(this.directory);
        let entryCount = 0;
        for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
          entryCount += 1;
          if (entryCount > this.maximumClaims + 2) return "unavailable";
          if (entry.name === REGISTRY_FILE) {
            if (!entry.isFile()) return "unavailable";
            continue;
          }
          if (entry.name === STAGING_DIRECTORY) {
            if (!entry.isDirectory()) return "unavailable";
            continue;
          }
          const index = slotIndex(entry.name, this.maximumClaims);
          if (index === null || !entry.isFile() || occupied.has(index)) return "unavailable";
          const observed = this.inspectClaim(resolve(this.directory, entry.name));
          if (observed === "absent" || observed === "unavailable") return "unavailable";
          if (observed.record.identityHash === digest) {
            return observed.bytes === expected ? "duplicate" : "unavailable";
          }
          occupied.add(index);
        }
      } finally {
        directory?.closeSync();
      }
      if (occupied.size >= this.maximumClaims) return "capacity_exceeded";

      const start = startingSlot(digest, this.maximumClaims);
      for (let probe = 0; probe < this.maximumClaims; probe += 1) {
        const index = (start + probe) % this.maximumClaims;
        if (occupied.has(index)) continue;
        const path = resolve(this.directory, slotName(index));
        const publication = this.publishImmutable(path, expected);
        if (publication === "unavailable") return "unavailable";
        if (publication === "exists") {
          const observed = this.inspectClaim(path);
          if (observed === "absent" || observed === "unavailable") return "unavailable";
          if (observed.record.identityHash === digest) {
            return observed.bytes === expected ? "duplicate" : "unavailable";
          }
          occupied.add(index);
          continue;
        }
        const verified = this.inspectClaim(path);
        if (
          verified === "absent"
          || verified === "unavailable"
          || verified.bytes !== expected
        ) {
          return "unavailable";
        }
        return "claimed";
      }
      return "capacity_exceeded";
    } catch {
      return "unavailable";
    }
  }
}

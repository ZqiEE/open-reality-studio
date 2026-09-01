import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  cloudContractVersion,
  evidenceExportSchema,
  submitEvidencePayloadSchema,
  verifyCloudEvidence,
  verifyEvidenceChain,
  type CloudEvidence,
  type EvidenceExport,
} from "../../packages/cloud-client";
import { ros2ProposalEnvelopeSchema } from "../../packages/ros2-reference-gateway";
import {
  executablePolicyHash,
  executablePolicySpecSchema,
} from "../../packages/core/exec-spec";
import { canonicalJson } from "../../packages/core/evidence";
import packageMetadata from "../../package.json";

type Options = Record<string, string>;
type ExpectedOutcome = "PASS" | "BLOCK";

const CASES = [
  { id: "clean_install", expected: "PASS", exitCode: 0, observer: false, evidence: false, approval: false, subject: false, required: true },
  { id: "setup_zero_to_shadow", expected: "PASS", exitCode: 0, observer: true, evidence: true, approval: true, subject: true, required: true },
  { id: "malformed_input", expected: "BLOCK", exitCode: 2, observer: true, evidence: false, approval: false, subject: true, required: true },
  // Initial malformed/stale inputs fail before a complete proposal/state
  // identity exists, so the independent observer and command log are the
  // proof. Requiring synthetic Core Evidence here would be misleading.
  { id: "stale_state", expected: "BLOCK", exitCode: 2, observer: true, evidence: false, approval: false, subject: true, required: true },
  { id: "duplicate_replay", expected: "BLOCK", exitCode: 2, observer: true, evidence: true, approval: false, subject: true, required: true },
  { id: "restart_shadow", expected: "PASS", exitCode: 0, observer: true, evidence: true, approval: false, subject: true, required: true },
  { id: "revoked_release", expected: "BLOCK", exitCode: 2, observer: true, evidence: true, approval: false, subject: true, required: true },
  { id: "configuration_drift", expected: "BLOCK", exitCode: 2, observer: true, evidence: true, approval: false, subject: true, required: true },
  { id: "evidence_tamper", expected: "BLOCK", exitCode: 2, observer: false, evidence: false, approval: false, subject: true, required: true },
] as const;

const RESPONSIBILITY_BOUNDARY = [
  "RLSOK determines whether a specific release is eligible for the configured controller path.",
  "RLSOK does not determine whether the resulting physical motion is safe.",
] as const;
const MAX_EXTERNAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

type CaseId = (typeof CASES)[number]["id"];

interface ValidationManifest {
  schema: "rlsok.io/external-ros2-validation-manifest/v1";
  status: "PENDING" | "COLLECTED";
  sessionId: string;
  generatedAt: string;
  files: Array<{ path: string; sha256: string }>;
}

interface ValidationSession {
  schema: "rlsok.io/external-ros2-validation-session/v1";
  sessionId: string;
  operator: string;
  target: string;
  createdAt: string;
  environment: {
    runtimeVersion: string;
    nodeVersion: string;
    platform: string;
    architecture: string;
    rosDistro: string | null;
    rmwImplementation: string | null;
    rosDomainId: string | null;
  };
}

interface ZeroDispatchObserver {
  schema: "rlsok.io/zero-dispatch-observer/v1";
  sessionId: string;
  caseId: CaseId;
  commandSha256: string;
  invocationSha256: string;
  observerInstanceId: string;
  nonce: string;
  observerId: string;
  implementation: string;
  independentFromRlsok: true;
  commandPath: string;
  armedBeforeCommand: true;
  commandPathMatched: true;
  qosCompatible: true;
  armedAt: string;
  serverReadyAt: string;
  commandStartedAt: string;
  rlsokClientMatchedAt: string | null;
  jointStateSubscriberMatchedAt: string;
  jointStatePublicationsBeforePause: number;
  lastJointStatePublishedAt: string;
  statePausedAt: string | null;
  commandFinishedAt: string;
  settleFinishedAt: string;
  commandServerCountAtArm: 1;
  maximumCommandServerCount: 1;
  baselineDispatchCount: number;
  finalDispatchCount: number;
  rlsokDispatchesObserved: 0;
  goalRequests: [];
  acceptedGoalCancelCallbacks: 0;
  observerCompleted: true;
  terminationReason: "settle_complete";
  statePausedDuringWindow: boolean;
  configurationDriftDuringWindow: boolean;
}

interface ApprovalProof {
  schema: "rlsok.io/external-approval-proof/v1";
  sessionId: string;
  releaseId: string;
  executablePolicyHash: string;
  runtimeCredentialId: string;
  approverPrincipalId: string;
  independentlyApproved: true;
  approvedAt: string;
  cloudReleaseReceiptSha256: string;
}

interface CommandInvocation {
  schema: "rlsok.io/external-command-invocation/v1";
  sessionId: string;
  caseId: CaseId;
  commandSha256: string;
  capturedAt: string;
  environment: {
    runtimeBinary: string;
    runtimeBinarySha256: string;
    runtimeVersion: string;
    rosDistro: string | null;
    rmwImplementation: string | null;
    rosDomainId: string | null;
    cloudBaseUrl: string | null;
    controllerAction: string | null;
    jointStateTopic: string | null;
    joints: string[] | null;
    setupPath: string | null;
    setupStateSha256: string | null;
    proposalPath: string | null;
    proposalSha256: string | null;
    policyArtifactPath: string | null;
    policyArtifactSha256: string | null;
    pauseState: boolean;
    configurationDrift: boolean;
  };
}

interface CommandExecution {
  schema: "rlsok.io/external-command-execution/v1";
  sessionId: string;
  caseId: CaseId;
  invocationSha256: string;
  commandSha256: string;
  commandLogSha256: string;
  observerSha256: string | null;
  commandExitCode: number;
  commandStartedAt: string;
  commandFinishedAt: string;
}

interface NormalizedEvidence {
  format: "CloudConnectedRos2Result";
  releaseId: string;
  executablePolicyHash: string;
  proposalId: string;
  decision: "allowed" | "blocked";
  reason: string;
  hardwareSignalSent: false;
  controllerGoalsAttempted: 0;
  evidenceVerified: true;
  cloudEvidenceId: string;
  cloudPermitId: string | null;
  cloudPermitConsumed: boolean;
  cloudPermitConsumptionState: "not_consumed" | "consumed" | "unknown";
  localPermitConsumed: boolean;
  actionHash: string;
  deviceId: string;
  controllerId: string;
  expectedConfigurationDigest: string;
  observedConfigurationDigest: string | null;
  cloudEvidenceSequence: number;
  cloudEvidencePreviousHash: string | null;
  cloudEvidenceHash: string;
  cloudEvidenceCreatedAt: string;
}

interface NegativeRuntimeResult {
  schema: "rlsok.io/external-negative-runtime-result/v1";
  sessionId: string;
  caseId: "malformed_input" | "stale_state";
  reason: string;
  subjectSha256: string;
  runtimeLogSha256: string;
  observedAt: string;
}

interface CaseRecord {
  schema: "rlsok.io/external-ros2-validation-case/v1";
  sessionId: string;
  caseId: CaseId;
  expectedOutcome: ExpectedOutcome;
  actualOutcome: ExpectedOutcome;
  reason: string;
  exitCode: number;
  recordedAt: string;
  artifacts: {
    command: { path: string; sha256: string };
    log: { path: string; sha256: string };
    invocation: { path: string; sha256: string };
    execution: { path: string; sha256: string };
    subject?: { path: string; sha256: string };
    originalEvidenceChain?: { path: string; sha256: string };
    runtimeLog?: { path: string; sha256: string };
    negativeResult?: { path: string; sha256: string };
    observer?: { path: string; sha256: string };
    evidence?: { path: string; sha256: string };
    cloudEvidence?: { path: string; sha256: string };
    approval?: { path: string; sha256: string };
    releaseReceipt?: { path: string; sha256: string };
  };
  observer?: ZeroDispatchObserver;
  evidence?: NormalizedEvidence;
  approval?: ApprovalProof;
  negativeResult?: NegativeRuntimeResult;
}

interface ExternalValidationResult {
  schema: "rlsok.io/external-ros2-validation-result/v1";
  status: "COLLECTED_SELF_ATTESTED";
  reviewStatus: "EXTERNAL_REVIEW_REQUIRED";
  sessionId: string;
  operator: string;
  target: string;
  releaseId: string;
  executablePolicyHash: string;
  completedAt: string;
  assurance: {
    artifactIntegrity: "PASS";
    evidenceInternalConsistency: "PASS";
    cloudEvidenceAuthenticity: "SELF_ATTESTED";
    cloudEvidenceChainContinuity: "EXTERNAL_REVIEW_REQUIRED";
    observerAndEnvironmentAuthenticity: "SELF_ATTESTED";
    independentApprovalAuthenticity: "SELF_ATTESTED";
  };
  cases: Array<{
    caseId: CaseId;
    outcome: ExpectedOutcome;
    reason: string;
    exitCode: number;
    evidenceVerified: true | null;
    zeroDispatchSelfAttestationChecked: true | null;
  }>;
  limitations: string[];
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`expected --option value, got ${name ?? "nothing"}`);
    }
    const key = name.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`duplicate option --${key}`);
    }
    options[key] = value;
  }
  return options;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function assertExactOptions(options: Options, allowed: readonly string[]): void {
  for (const name of Object.keys(options)) {
    if (!allowed.includes(name)) throw new Error(`unexpected option --${name}`);
  }
}

function safeText(value: string, label: string): string {
  if (value.trim() !== value || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new Error(`${label}_invalid`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error(`${label}_invalid`);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offset = match[8]!;
  const offsetHour = offset === "Z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === "Z" ? 0 : Number(offset.slice(4, 6));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1970 || month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) {
    throw new Error(`${label}_invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}_invalid`);
  return parsed;
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const expected = new Set(allowed);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new Error(`${label}_fields_invalid`);
  }
}

function procedureDocument() {
  return {
    schema: "rlsok.io/external-ros2-validation-procedure/v1" as const,
    cases: CASES,
    zeroDispatchRequirement:
      "An independent matched observer must cover command start through settle and observe no FollowJointTrajectory goal request from RLSOK.",
  };
}

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readRegularFile(
  path: string,
  label: string,
  maximumBytes = 64 * 1024 * 1024,
): Buffer {
  let initial;
  try {
    initial = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${label}_missing`);
    throw error;
  }
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_non_symlink`);
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== initial.dev ||
      before.ino !== initial.ino ||
      before.size > maximumBytes
    ) {
      throw new Error(before.size > maximumBytes ? `${label}_too_large` : `${label}_changed_during_open`);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (
      after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs || offset !== before.size
    ) {
      throw new Error(`${label}_changed_during_read`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sha256File(path: string, label = "artifact", maximumBytes = 64 * 1024 * 1024): string {
  return sha256Bytes(readRegularFile(path, label, maximumBytes));
}

function assertRegularFile(path: string, label: string, maximumBytes = 64 * 1024 * 1024): void {
  readRegularFile(path, label, maximumBytes);
}

function readJsonObject(
  path: string,
  label: string,
  maximumBytes = 16 * 1024 * 1024,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readRegularFile(path, label, maximumBytes).toString("utf8"));
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function fsyncParentDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeProtected(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const content = Buffer.isBuffer(value)
    ? value
    : typeof value === "string"
      ? value
      : `${JSON.stringify(value, null, 2)}\n`;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.rlsok-tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
    fsyncParentDirectory(path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function withSessionLock<T>(output: string, operation: () => T): T {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const lockPath = `${output}.rlsok-validation.lock`;
  const lockBytes = Buffer.from(
    `${JSON.stringify({ pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() })}\n`,
  );
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`validation_session_locked:${lockPath}:run_recover_after_confirming_owner_exited`);
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, lockBytes);
    fsyncSync(descriptor);
    return operation();
  } finally {
    closeSync(descriptor);
    const claimedPath = `${lockPath}.${randomUUID()}.rlsok-releasing`;
    renameSync(lockPath, claimedPath);
    const claimedBytes = readRegularFile(claimedPath, "owned_validation_session_lock", 64 * 1024);
    if (!claimedBytes.equals(lockBytes)) {
      if (!existsSync(lockPath)) renameSync(claimedPath, lockPath);
      throw new Error("validation_session_lock_ownership_changed");
    }
    rmSync(claimedPath);
    fsyncParentDirectory(claimedPath);
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "EINVAL") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function clearDeadSessionLock(output: string): boolean {
  const lockPath = `${output}.rlsok-validation.lock`;
  if (!existsSync(lockPath)) return false;
  const initialBytes = readRegularFile(lockPath, "validation_session_lock", 64 * 1024);
  let lock: Record<string, unknown>;
  try {
    lock = JSON.parse(initialBytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("validation_session_lock_invalid_json");
  }
  assertExactObjectKeys(lock, ["pid", "nonce", "createdAt"], "validation_session_lock");
  if (
    !Number.isInteger(lock.pid) || (lock.pid as number) < 1 || (lock.pid as number) > 2_147_483_647 ||
    typeof lock.nonce !== "string" || !isUuid(lock.nonce) ||
    timestamp(lock.createdAt, "validation_session_lock_created_at") > Date.now() + 60_000
  ) {
    throw new Error("validation_session_lock_invalid");
  }
  if (processIsAlive(lock.pid as number)) {
    throw new Error(`validation_session_lock_owner_still_running:${lock.pid}`);
  }
  const claimedPath = `${lockPath}.${randomUUID()}.rlsok-recovering`;
  renameSync(lockPath, claimedPath);
  fsyncParentDirectory(claimedPath);
  const claimedBytes = readRegularFile(claimedPath, "claimed_validation_session_lock", 64 * 1024);
  if (!claimedBytes.equals(initialBytes)) {
    if (!existsSync(lockPath)) renameSync(claimedPath, lockPath);
    throw new Error("validation_session_lock_changed_during_recovery");
  }
  rmSync(claimedPath);
  fsyncParentDirectory(claimedPath);
  return true;
}

function copyProtected(
  source: string,
  destination: string,
  label: string,
  maximumBytes = 64 * 1024 * 1024,
): { path: string; sha256: string } {
  const resolved = resolve(source);
  const bytes = readRegularFile(resolved, label, maximumBytes);
  writeProtected(destination, bytes);
  return { path: destination, sha256: sha256Bytes(bytes) };
}

function filesBelow(root: string): string[] {
  const result: string[] = [];
  let totalBytes = 0;
  const visit = (directory: string, depth: number) => {
    if (depth > 4) throw new Error("validation_output_directory_depth_exceeded");
    const before = lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error("validation_output_contains_non_regular_entry");
    }
    const entries = readdirSync(directory, { withFileTypes: true });
    const after = lstatSync(directory);
    if (
      !after.isDirectory() || after.isSymbolicLink() ||
      after.dev !== before.dev || after.ino !== before.ino
    ) {
      throw new Error("validation_output_directory_changed_during_traversal");
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("validation_output_contains_non_regular_entry");
      if (stat.isDirectory()) visit(path, depth + 1);
      else if (stat.isFile()) {
        const remaining = 512 * 1024 * 1024 - totalBytes;
        const bytes = readRegularFile(path, "validation_output_artifact", Math.min(64 * 1024 * 1024, remaining));
        totalBytes += bytes.byteLength;
        if (result.length >= 128 || totalBytes > 512 * 1024 * 1024) {
          throw new Error("validation_output_resource_limit_exceeded");
        }
        result.push(path);
      }
      else throw new Error("validation_output_contains_non_regular_entry");
    }
  };
  visit(root, 0);
  return result;
}

function assertOutputDirectory(output: string): void {
  if (!existsSync(output)) throw new Error("validation_output_missing");
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("validation_output_must_be_directory_non_symlink");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("validation_output_permissions_must_be_user_only");
  }
}

function writeManifest(output: string, status: "PENDING" | "COLLECTED", sessionId: string): void {
  const excluded = new Set(["manifest.json", "SHA256SUMS"]);
  const files = filesBelow(output)
    .map((path) => relative(output, path).replaceAll("\\", "/"))
    .filter((path) => !excluded.has(path))
    .sort()
    .map((path) => ({ path, sha256: sha256File(join(output, ...path.split("/"))) }));
  writeProtected(join(output, "manifest.json"), {
    schema: "rlsok.io/external-ros2-validation-manifest/v1",
    status,
    sessionId,
    generatedAt: new Date().toISOString(),
    files,
  } satisfies ValidationManifest);
  const withManifest = [
    ...files,
    { path: "manifest.json", sha256: sha256File(join(output, "manifest.json")) },
  ];
  writeProtected(
    join(output, "SHA256SUMS"),
    `${withManifest.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
  );
}

function readVerifiedManifest(output: string, status: "PENDING" | "COLLECTED"): ValidationManifest {
  assertOutputDirectory(output);
  const manifestPath = join(output, "manifest.json");
  const manifest = readJsonObject(manifestPath, "validation_manifest") as unknown as ValidationManifest;
  if (
    manifest.schema !== "rlsok.io/external-ros2-validation-manifest/v1" ||
    manifest.status !== status ||
    typeof manifest.sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(manifest.sessionId) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 128 ||
    !Number.isFinite(Date.parse(manifest.generatedAt))
  ) {
    throw new Error("validation_manifest_identity_invalid");
  }
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.path.includes("\\") ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
      ["manifest.json", "SHA256SUMS"].includes(entry.path) ||
      seen.has(entry.path)
    ) {
      throw new Error("validation_manifest_entry_invalid");
    }
    seen.add(entry.path);
    const path = join(output, ...entry.path.split("/"));
    assertRegularFile(path, `validation_artifact:${entry.path}`);
    if (sha256File(path) !== entry.sha256) {
      throw new Error(`validation_artifact_hash_mismatch:${entry.path}`);
    }
  }
  const actual = filesBelow(output)
    .map((path) => relative(output, path).replaceAll("\\", "/"))
    .filter((path) => !["manifest.json", "SHA256SUMS"].includes(path))
    .sort();
  if (actual.length !== seen.size || actual.some((path) => !seen.has(path))) {
    throw new Error("validation_output_contains_unmanifested_artifact");
  }
  const checksumPath = join(output, "SHA256SUMS");
  assertRegularFile(checksumPath, "validation_checksums");
  const expected = `${[
    ...manifest.files,
    { path: "manifest.json", sha256: sha256File(manifestPath) },
  ].map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`;
  if (readRegularFile(checksumPath, "validation_checksums", 1024 * 1024).toString("utf8") !== expected) {
    throw new Error("validation_checksums_mismatch");
  }
  return manifest;
}

function parseObserver(
  path: string,
  expected: {
    sessionId: string;
    caseId: CaseId;
    commandSha256: string;
    invocationSha256: string;
    invocationCapturedAt: string;
    sessionCreatedAt: string;
  },
): ZeroDispatchObserver {
  const raw = readJsonObject(path, "observer");
  assertExactObjectKeys(raw, [
    "schema", "sessionId", "caseId", "commandSha256", "invocationSha256", "observerInstanceId",
    "nonce", "observerId", "implementation", "independentFromRlsok",
    "commandPath", "armedBeforeCommand", "commandPathMatched", "qosCompatible",
    "armedAt", "serverReadyAt", "commandStartedAt", "rlsokClientMatchedAt", "commandFinishedAt",
    "jointStateSubscriberMatchedAt", "jointStatePublicationsBeforePause",
    "lastJointStatePublishedAt", "statePausedAt",
    "settleFinishedAt", "commandServerCountAtArm", "maximumCommandServerCount",
    "baselineDispatchCount", "finalDispatchCount", "rlsokDispatchesObserved",
    "goalRequests", "acceptedGoalCancelCallbacks",
    "observerCompleted", "terminationReason", "statePausedDuringWindow",
    "configurationDriftDuringWindow",
  ], "observer");
  const value = raw as unknown as ZeroDispatchObserver;
  if (
    value.schema !== "rlsok.io/zero-dispatch-observer/v1" ||
    value.sessionId !== expected.sessionId ||
    value.caseId !== expected.caseId ||
    value.commandSha256 !== expected.commandSha256 ||
    value.invocationSha256 !== expected.invocationSha256 ||
    typeof value.observerInstanceId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.observerInstanceId) ||
    typeof value.nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(value.nonce) ||
    typeof value.observerId !== "string" || !value.observerId ||
    typeof value.implementation !== "string" || !value.implementation ||
    value.independentFromRlsok !== true ||
    typeof value.commandPath !== "string" || !value.commandPath ||
    value.armedBeforeCommand !== true ||
    value.commandPathMatched !== true ||
    value.qosCompatible !== true ||
    value.commandServerCountAtArm !== 1 ||
    value.maximumCommandServerCount !== 1 ||
    !Number.isInteger(value.baselineDispatchCount) || value.baselineDispatchCount < 0 ||
    !Number.isInteger(value.finalDispatchCount) || value.finalDispatchCount < 0 ||
    value.finalDispatchCount !== value.baselineDispatchCount ||
    value.rlsokDispatchesObserved !== 0 ||
    !Array.isArray(value.goalRequests) || value.goalRequests.length !== 0 ||
    value.acceptedGoalCancelCallbacks !== 0 ||
    !Number.isInteger(value.jointStatePublicationsBeforePause) ||
    value.jointStatePublicationsBeforePause < 1 ||
    value.observerCompleted !== true ||
    value.terminationReason !== "settle_complete" ||
    typeof value.statePausedDuringWindow !== "boolean" ||
    typeof value.configurationDriftDuringWindow !== "boolean" ||
    value.statePausedDuringWindow !== (expected.caseId === "stale_state") ||
    value.configurationDriftDuringWindow !== (expected.caseId === "configuration_drift")
  ) {
    throw new Error("observer_did_not_prove_independent_zero_dispatch");
  }
  const armedAt = timestamp(value.armedAt, "observer_armed_at");
  const serverReadyAt = timestamp(value.serverReadyAt, "observer_server_ready_at");
  const startedAt = timestamp(value.commandStartedAt, "observer_command_started_at");
  const clientMatchedAt = value.rlsokClientMatchedAt === null
    ? null
    : timestamp(value.rlsokClientMatchedAt, "observer_rlsok_client_matched_at");
  const stateSubscriberMatchedAt = timestamp(
    value.jointStateSubscriberMatchedAt,
    "observer_joint_state_subscriber_matched_at",
  );
  const lastJointStatePublishedAt = timestamp(
    value.lastJointStatePublishedAt,
    "observer_last_joint_state_published_at",
  );
  const statePausedAt = value.statePausedAt === null
    ? null
    : timestamp(value.statePausedAt, "observer_state_paused_at");
  const finishedAt = timestamp(value.commandFinishedAt, "observer_command_finished_at");
  const settledAt = timestamp(value.settleFinishedAt, "observer_settle_finished_at");
  const sessionCreatedAt = timestamp(expected.sessionCreatedAt, "validation_session_created_at");
  const invocationCapturedAt = timestamp(expected.invocationCapturedAt, "command_invocation_captured_at");
  const maximumFuture = Date.now() + 60_000;
  if (
    !(sessionCreatedAt <= invocationCapturedAt && invocationCapturedAt <= armedAt && armedAt <= serverReadyAt && serverReadyAt <= startedAt && startedAt < finishedAt && finishedAt < settledAt) ||
    clientMatchedAt === null || clientMatchedAt < startedAt || clientMatchedAt > finishedAt ||
    stateSubscriberMatchedAt < startedAt || stateSubscriberMatchedAt > finishedAt ||
    lastJointStatePublishedAt < stateSubscriberMatchedAt ||
    lastJointStatePublishedAt > finishedAt ||
    (expected.caseId === "stale_state" && (
      value.jointStatePublicationsBeforePause < 10 ||
      statePausedAt === null || statePausedAt <= lastJointStatePublishedAt || statePausedAt > finishedAt
    )) ||
    (expected.caseId !== "stale_state" && statePausedAt !== null) ||
    settledAt - finishedAt < 100 ||
    settledAt - finishedAt > 30_000 ||
    settledAt > maximumFuture
  ) {
    throw new Error("observer_did_not_cover_command_and_settle_window");
  }
  return value;
}

function parseApproval(
  path: string,
  releaseReceiptPath: string,
  expected: { sessionId: string; sessionCreatedAt: string },
): ApprovalProof {
  const rawApproval = readJsonObject(path, "approval");
  assertExactObjectKeys(rawApproval, [
    "schema", "sessionId", "releaseId", "executablePolicyHash",
    "runtimeCredentialId", "approverPrincipalId", "independentlyApproved",
    "approvedAt", "cloudReleaseReceiptSha256",
  ], "approval");
  const value = rawApproval as unknown as ApprovalProof;
  const rawReleaseReceipt = readJsonObject(releaseReceiptPath, "cloud_release_receipt");
  assertExactObjectKeys(
    rawReleaseReceipt,
    ["releaseId", "contentHash", "state", "execSpec"],
    "cloud_release_receipt",
  );
  const parsedExecSpec = executablePolicySpecSchema.safeParse(rawReleaseReceipt.execSpec);
  if (
    typeof rawReleaseReceipt.releaseId !== "string" || !rawReleaseReceipt.releaseId ||
    typeof rawReleaseReceipt.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(rawReleaseReceipt.contentHash) ||
    rawReleaseReceipt.state !== "approved" ||
    !parsedExecSpec.success
  ) {
    throw new Error("cloud_release_receipt_invalid");
  }
  const releaseReceipt = {
    releaseId: rawReleaseReceipt.releaseId,
    contentHash: rawReleaseReceipt.contentHash,
    state: rawReleaseReceipt.state,
  };
  const releaseExecSpec = parsedExecSpec.data;
  if (
    value.schema !== "rlsok.io/external-approval-proof/v1" ||
    value.sessionId !== expected.sessionId ||
    typeof value.releaseId !== "string" || !value.releaseId ||
    !/^[a-f0-9]{64}$/.test(value.executablePolicyHash) ||
    typeof value.runtimeCredentialId !== "string" || !value.runtimeCredentialId ||
    typeof value.approverPrincipalId !== "string" || !value.approverPrincipalId ||
    value.runtimeCredentialId === value.approverPrincipalId ||
    value.independentlyApproved !== true ||
    !/^[a-f0-9]{64}$/.test(value.cloudReleaseReceiptSha256) ||
    value.cloudReleaseReceiptSha256 !== sha256File(releaseReceiptPath) ||
    releaseReceipt.releaseId !== value.releaseId ||
    releaseReceipt.contentHash !== value.executablePolicyHash ||
    executablePolicyHash(releaseExecSpec) !== releaseReceipt.contentHash ||
    releaseReceipt.state !== "approved" ||
    releaseExecSpec.metadata.releaseId !== value.releaseId ||
    releaseExecSpec.evidence.status !== "approved" ||
    releaseExecSpec.evidence.approvedBy !== value.approverPrincipalId ||
    releaseExecSpec.evidence.approvedAt !== value.approvedAt ||
    timestamp(value.approvedAt, "approval_approved_at") <
      timestamp(expected.sessionCreatedAt, "validation_session_created_at") - MAX_EXTERNAL_CLOCK_SKEW_MS ||
    timestamp(value.approvedAt, "approval_approved_at") > Date.now() + MAX_EXTERNAL_CLOCK_SKEW_MS
  ) {
    throw new Error("approval_proof_invalid_or_not_independent");
  }
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type ValidProposal = ReturnType<typeof ros2ProposalEnvelopeSchema.parse>;

function readCaseProposal(
  path: string,
  caseId: CaseId,
): ValidProposal | null {
  if (caseId === "evidence_tamper") return null;
  assertRegularFile(path, `case_subject:${caseId}`, 16 * 1024 * 1024);
  let raw: unknown;
  try {
    raw = JSON.parse(readRegularFile(path, `case_subject:${caseId}`, 16 * 1024 * 1024).toString("utf8"));
  } catch {
    if (caseId === "malformed_input") return null;
    throw new Error(`case_subject_invalid_json:${caseId}`);
  }
  const parsed = ros2ProposalEnvelopeSchema.safeParse(raw);
  if (caseId === "malformed_input") {
    if (parsed.success) throw new Error("malformed_input_subject_was_valid_proposal");
    return null;
  }
  if (!parsed.success) throw new Error(`case_subject_not_valid_ros2_proposal:${caseId}`);
  return parsed.data;
}

function readEvidenceExport(path: string, label: string): EvidenceExport {
  try {
    return evidenceExportSchema.parse(readJsonObject(path, label, 32 * 1024 * 1024));
  } catch (error) {
    throw new Error(`${label}_schema_invalid:${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEvidenceTamperPair(
  originalPath: string,
  tamperedPath: string,
): { original: EvidenceExport; tamperedSequence: number } {
  const original = readEvidenceExport(originalPath, "original_evidence_chain");
  const tampered = readEvidenceExport(tamperedPath, "tampered_evidence_chain");
  if (original.records.length === 0) throw new Error("original_evidence_chain_empty");
  const originalVerification = verifyEvidenceChain(original);
  if (!originalVerification.ok) {
    throw new Error(`original_evidence_chain_invalid:${originalVerification.reason}`);
  }
  if (original.records.length !== tampered.records.length) {
    throw new Error("evidence_tamper_changed_record_count");
  }
  const normalizedTampered = structuredClone(tampered);
  const changedSequences: number[] = [];
  for (let index = 0; index < original.records.length; index += 1) {
    const originalRecord = original.records[index]!;
    const tamperedRecord = normalizedTampered.records[index]!;
    if (originalRecord.evidenceHash !== tamperedRecord.evidenceHash) {
      changedSequences.push(originalRecord.sequence);
      tamperedRecord.evidenceHash = originalRecord.evidenceHash;
    }
  }
  if (changedSequences.length !== 1 || canonicalJson(normalizedTampered) !== canonicalJson(original)) {
    throw new Error("evidence_tamper_must_change_exactly_one_evidence_hash");
  }
  const tamperedSequence = changedSequences[0]!;
  const tamperedVerification = verifyEvidenceChain(tampered);
  if (
    tamperedVerification.ok ||
    tamperedVerification.reason !== `evidence_hash_mismatch:${tamperedSequence}`
  ) {
    throw new Error("tampered_evidence_chain_did_not_fail_with_exact_hash_mismatch");
  }
  return { original, tamperedSequence };
}

function proposalActionHash(proposal: ValidProposal): string {
  return sha256Bytes(canonicalJson(proposal.actionPayload));
}

function parseInvocation(
  path: string,
  expected: {
    session: ValidationSession;
    caseId: CaseId;
    commandSha256: string;
  },
): CommandInvocation {
  const raw = readJsonObject(path, "command_invocation", 1024 * 1024);
  assertExactObjectKeys(raw, [
    "schema", "sessionId", "caseId", "commandSha256", "capturedAt", "environment",
  ], "command_invocation");
  if (!raw.environment || typeof raw.environment !== "object" || Array.isArray(raw.environment)) {
    throw new Error("command_invocation_environment_invalid");
  }
  const environment = raw.environment as Record<string, unknown>;
  assertExactObjectKeys(environment, [
    "runtimeBinary", "runtimeBinarySha256", "runtimeVersion", "rosDistro",
    "rmwImplementation", "rosDomainId", "cloudBaseUrl", "controllerAction",
    "jointStateTopic", "joints", "setupPath", "setupStateSha256", "proposalPath",
    "proposalSha256", "policyArtifactPath", "policyArtifactSha256", "pauseState",
    "configurationDrift",
  ], "command_invocation_environment");
  const value = raw as unknown as CommandInvocation;
  const nullableText = [
    value.environment.rosDistro, value.environment.rmwImplementation,
    value.environment.rosDomainId, value.environment.cloudBaseUrl,
    value.environment.controllerAction, value.environment.jointStateTopic,
  ];
  const pathHashPairs = [
    [value.environment.setupPath, value.environment.setupStateSha256],
    [value.environment.proposalPath, value.environment.proposalSha256],
    [value.environment.policyArtifactPath, value.environment.policyArtifactSha256],
  ] as const;
  if (
    value.schema !== "rlsok.io/external-command-invocation/v1" ||
    value.sessionId !== expected.session.sessionId ||
    value.caseId !== expected.caseId ||
    value.commandSha256 !== expected.commandSha256 ||
    typeof value.environment.runtimeBinary !== "string" ||
    !isAbsolute(value.environment.runtimeBinary) || value.environment.runtimeBinary.length > 4096 ||
    !/^[a-f0-9]{64}$/.test(value.environment.runtimeBinarySha256) ||
    typeof value.environment.runtimeVersion !== "string" ||
    value.environment.runtimeVersion.length < 1 || value.environment.runtimeVersion.length > 256 ||
    nullableText.some((entry) => entry !== null && (typeof entry !== "string" || entry.length > 4096)) ||
    pathHashPairs.some(([entryPath, hash]) =>
      (entryPath === null) !== (hash === null) ||
      (entryPath !== null && (typeof entryPath !== "string" || !isAbsolute(entryPath) || entryPath.length > 4096)) ||
      (hash !== null && !/^[a-f0-9]{64}$/.test(hash))) ||
    !(value.environment.joints === null || (
      Array.isArray(value.environment.joints) &&
      value.environment.joints.length >= 1 && value.environment.joints.length <= 64 &&
      value.environment.joints.every((joint) => typeof joint === "string" && joint.length >= 1 && joint.length <= 256) &&
      new Set(value.environment.joints).size === value.environment.joints.length
    )) ||
    value.environment.pauseState !== (expected.caseId === "stale_state") ||
    value.environment.configurationDrift !== (expected.caseId === "configuration_drift") ||
    value.environment.rosDistro !== expected.session.environment.rosDistro ||
    value.environment.rmwImplementation !== expected.session.environment.rmwImplementation ||
    value.environment.rosDomainId !== expected.session.environment.rosDomainId
  ) {
    throw new Error("command_invocation_binding_invalid");
  }
  const capturedAt = timestamp(value.capturedAt, "command_invocation_captured_at");
  if (
    capturedAt < timestamp(expected.session.createdAt, "validation_session_created_at") ||
    capturedAt > Date.now() + 60_000
  ) {
    throw new Error("command_invocation_time_invalid");
  }
  return value;
}

function parseExecution(
  path: string,
  expected: {
    session: ValidationSession;
    caseId: CaseId;
    invocationSha256: string;
    commandSha256: string;
    commandLogSha256: string;
    observerSha256: string | null;
  },
): CommandExecution {
  const raw = readJsonObject(path, "command_execution", 1024 * 1024);
  assertExactObjectKeys(raw, [
    "schema", "sessionId", "caseId", "invocationSha256", "commandSha256",
    "commandLogSha256", "observerSha256", "commandExitCode", "commandStartedAt",
    "commandFinishedAt",
  ], "command_execution");
  const value = raw as unknown as CommandExecution;
  if (
    value.schema !== "rlsok.io/external-command-execution/v1" ||
    value.sessionId !== expected.session.sessionId ||
    value.caseId !== expected.caseId ||
    value.invocationSha256 !== expected.invocationSha256 ||
    value.commandSha256 !== expected.commandSha256 ||
    value.commandLogSha256 !== expected.commandLogSha256 ||
    value.observerSha256 !== expected.observerSha256 ||
    !Number.isInteger(value.commandExitCode) || value.commandExitCode < 0 || value.commandExitCode > 255
  ) {
    throw new Error("command_execution_binding_invalid");
  }
  const startedAt = timestamp(value.commandStartedAt, "command_execution_started_at");
  const finishedAt = timestamp(value.commandFinishedAt, "command_execution_finished_at");
  if (
    startedAt < timestamp(expected.session.createdAt, "validation_session_created_at") ||
    startedAt >= finishedAt ||
    finishedAt > Date.now() + 60_000
  ) {
    throw new Error("command_execution_time_invalid");
  }
  return value;
}

function parseEvidence(path: string, cloudEvidencePath: string): NormalizedEvidence {
  const value = readJsonObject(path, "evidence");
  assertExactObjectKeys(value, [
    "executionMode", "mode", "releaseId", "proposalId", "decision", "reason",
    "cloudPermitId", "cloudPermitConsumed", "cloudPermitConsumptionState",
    "localPermitConsumed",
    "controllerGoalsAttempted", "hardwareSignalSent", "cloudEvidenceId",
    "evidenceVerified", "responsibilityBoundary",
  ], "evidence");
  if (
    value.executionMode !== "cloud-connected" ||
    value.mode !== "shadow" ||
    typeof value.releaseId !== "string" || !value.releaseId ||
    typeof value.proposalId !== "string" || !value.proposalId ||
    !["allowed", "blocked"].includes(String(value.decision)) ||
    typeof value.reason !== "string" || !value.reason ||
    value.hardwareSignalSent !== false ||
    value.controllerGoalsAttempted !== 0 ||
    value.evidenceVerified !== true ||
    !isUuid(value.cloudEvidenceId) ||
    !(value.cloudPermitId === null || isUuid(value.cloudPermitId)) ||
    typeof value.cloudPermitConsumed !== "boolean" ||
    !["not_consumed", "consumed", "unknown"].includes(
      String(value.cloudPermitConsumptionState),
    ) ||
    typeof value.localPermitConsumed !== "boolean" ||
    !Array.isArray(value.responsibilityBoundary) ||
    value.responsibilityBoundary.length !== RESPONSIBILITY_BOUNDARY.length ||
    value.responsibilityBoundary.some((entry, index) => entry !== RESPONSIBILITY_BOUNDARY[index]) ||
    Object.prototype.hasOwnProperty.call(value, "controllerResult")
  ) {
    throw new Error("cloud_evidence_did_not_prove_verified_zero_dispatch_decision");
  }
  if (
    value.decision === "allowed" &&
    (value.cloudPermitId === null ||
      value.cloudPermitConsumed !== true ||
      value.cloudPermitConsumptionState !== "consumed" ||
      value.localPermitConsumed !== true)
  ) {
    throw new Error("allowed_shadow_did_not_consume_both_bound_permits");
  }
  const rawReceipt = readJsonObject(cloudEvidencePath, "cloud_evidence_receipt");
  assertExactObjectKeys(rawReceipt, [
    "id", "sequence", "releaseId", "permitId", "decision",
    "hardwareSignalSent", "payload", "previousHash", "evidenceHash", "createdAt",
  ], "cloud_evidence_receipt");
  const payload = submitEvidencePayloadSchema.safeParse(rawReceipt.payload);
  if (!payload.success) {
    throw new Error("cloud_evidence_receipt_payload_invalid");
  }
  const receipt: CloudEvidence = {
    id: rawReceipt.id as string,
    sequence: rawReceipt.sequence as number,
    releaseId: rawReceipt.releaseId as string,
    permitId: rawReceipt.permitId as string | null,
    decision: rawReceipt.decision as "allowed" | "blocked" | "failed",
    hardwareSignalSent: rawReceipt.hardwareSignalSent as boolean,
    payload: payload.data,
    previousHash: rawReceipt.previousHash as string | null,
    evidenceHash: rawReceipt.evidenceHash as string,
    createdAt: rawReceipt.createdAt as string,
  };
  if (
    !isUuid(receipt.id) ||
    !Number.isInteger(receipt.sequence) || receipt.sequence < 0 ||
    typeof receipt.releaseId !== "string" || !receipt.releaseId ||
    !(receipt.permitId === null || isUuid(receipt.permitId)) ||
    !["allowed", "blocked"].includes(receipt.decision) ||
    receipt.hardwareSignalSent !== false ||
    !(receipt.previousHash === null || /^[a-f0-9]{64}$/.test(receipt.previousHash)) ||
    !/^[a-f0-9]{64}$/.test(receipt.evidenceHash) ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    receipt.id !== value.cloudEvidenceId ||
    receipt.releaseId !== value.releaseId ||
    receipt.permitId !== value.cloudPermitId ||
    receipt.decision !== value.decision ||
    receipt.payload.contractVersion !== cloudContractVersion ||
    receipt.payload.evaluationMode !== (value.decision === "allowed" ? "shadow" : "denial") ||
    receipt.payload.reason !== value.reason ||
    receipt.payload.controllerGoalsAttempted !== 0 ||
    receipt.payload.localPermitConsumed !== value.localPermitConsumed ||
    receipt.payload.cloudPermitConsumptionState !==
      value.cloudPermitConsumptionState ||
    Object.prototype.hasOwnProperty.call(receipt.payload, "controllerResult")
  ) {
    throw new Error("cloud_evidence_receipt_did_not_bind_local_result");
  }
  const verified = verifyCloudEvidence(receipt);
  if (!verified.ok) throw new Error(`cloud_evidence_receipt_invalid:${verified.reason}`);
  return {
    format: "CloudConnectedRos2Result",
    releaseId: value.releaseId as string,
    executablePolicyHash: payload.data.contentHash,
    proposalId: value.proposalId as string,
    decision: value.decision as "allowed" | "blocked",
    reason: value.reason as string,
    hardwareSignalSent: false,
    controllerGoalsAttempted: 0,
    evidenceVerified: true,
    cloudEvidenceId: receipt.id,
    cloudPermitId: value.cloudPermitId as string | null,
    cloudPermitConsumed: value.cloudPermitConsumed as boolean,
    cloudPermitConsumptionState: value.cloudPermitConsumptionState as
      "not_consumed" | "consumed" | "unknown",
    localPermitConsumed: value.localPermitConsumed as boolean,
    actionHash: payload.data.actionHash,
    deviceId: payload.data.deviceId,
    controllerId: payload.data.controllerId,
    expectedConfigurationDigest: payload.data.expectedConfigurationDigest,
    observedConfigurationDigest: payload.data.observedConfigurationDigest,
    cloudEvidenceSequence: receipt.sequence,
    cloudEvidencePreviousHash: receipt.previousHash,
    cloudEvidenceHash: receipt.evidenceHash,
    cloudEvidenceCreatedAt: receipt.createdAt,
  };
}

function expectedDecision(outcome: ExpectedOutcome): "allowed" | "blocked" {
  return outcome === "PASS" ? "allowed" : "blocked";
}

function requiresNegativeRuntimeResult(caseId: CaseId): caseId is "malformed_input" | "stale_state" {
  return caseId === "malformed_input" || caseId === "stale_state";
}

function parseNegativeRuntimeResult(
  path: string,
  runtimeLogPath: string,
  expected: {
    sessionId: string;
    caseId: "malformed_input" | "stale_state";
    reason: string;
    subjectSha256: string;
    commandStartedAt: string;
    commandFinishedAt: string;
  },
): NegativeRuntimeResult {
  const raw = readJsonObject(path, "negative_runtime_result", 64 * 1024);
  assertExactObjectKeys(raw, [
    "schema", "sessionId", "caseId", "reason", "subjectSha256",
    "runtimeLogSha256", "observedAt",
  ], "negative_runtime_result");
  const value = raw as unknown as NegativeRuntimeResult;
  const runtimeLog = readRegularFile(runtimeLogPath, "negative_runtime_log", 8 * 1024 * 1024);
  const reasonLines = runtimeLog.toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Reason: "));
  const observedAt = timestamp(value.observedAt, "negative_runtime_result_observed_at");
  if (
    value.schema !== "rlsok.io/external-negative-runtime-result/v1" ||
    value.sessionId !== expected.sessionId ||
    value.caseId !== expected.caseId ||
    value.reason !== expected.reason ||
    value.subjectSha256 !== expected.subjectSha256 ||
    value.runtimeLogSha256 !== sha256Bytes(runtimeLog) ||
    reasonLines.length !== 1 || reasonLines[0] !== `Reason: ${expected.reason}` ||
    observedAt < timestamp(expected.commandStartedAt, "command_execution_started_at") ||
    observedAt > timestamp(expected.commandFinishedAt, "command_execution_finished_at")
  ) {
    throw new Error("negative_runtime_result_did_not_bind_exact_runtime_failure");
  }
  return value;
}

function assertCaseReason(caseId: CaseId, reason: string): void {
  const exact: Partial<Record<CaseId, readonly string[]>> = {
    clean_install: ["clean_install_verified"],
    malformed_input: ["proposal_invalid"],
    stale_state: ["joint_state_stale", "state_stale_or_invalid"],
    duplicate_replay: ["proposal_id_duplicate"],
    revoked_release: ["cloud_release_not_eligible:revoked"],
    configuration_drift: ["configuration_mismatch"],
    evidence_tamper: ["evidence_verification_failed"],
  };
  const allowed = exact[caseId];
  const shadowAllowed =
    ["setup_zero_to_shadow", "restart_shadow"].includes(caseId) &&
    (reason === "shadow_permit_evaluated_no_controller_call" ||
      reason.startsWith("shadow_observation_only:"));
  if (!shadowAllowed && (!allowed || !allowed.includes(reason))) {
    throw new Error(`case_reason_does_not_match_procedure:${caseId}:${reason}`);
  }
}

function readSession(output: string, sessionId: string): ValidationSession {
  const raw = readJsonObject(join(output, "session.json"), "validation_session");
  assertExactObjectKeys(raw, ["schema", "sessionId", "operator", "target", "createdAt", "environment"], "validation_session");
  if (raw.environment && typeof raw.environment === "object" && !Array.isArray(raw.environment)) {
    assertExactObjectKeys(raw.environment as Record<string, unknown>, [
      "runtimeVersion", "nodeVersion", "platform", "architecture", "rosDistro",
      "rmwImplementation", "rosDomainId",
    ], "validation_session_environment");
  }
  const session = raw as unknown as ValidationSession;
  if (
    session.schema !== "rlsok.io/external-ros2-validation-session/v1" ||
    session.sessionId !== sessionId ||
    typeof session.operator !== "string" || !session.operator ||
    typeof session.target !== "string" || !session.target ||
    timestamp(session.createdAt, "validation_session_created_at") > Date.now() + 60_000 ||
    !session.environment ||
    typeof session.environment.runtimeVersion !== "string" ||
    typeof session.environment.nodeVersion !== "string" ||
    typeof session.environment.platform !== "string" ||
    typeof session.environment.architecture !== "string" ||
    ![session.environment.rosDistro, session.environment.rmwImplementation, session.environment.rosDomainId]
      .every((value) => value === null || typeof value === "string")
  ) {
    throw new Error("validation_session_invalid");
  }
  return session;
}

function readProcedure(output: string): void {
  const procedure = readJsonObject(join(output, "procedure.json"), "validation_procedure");
  if (JSON.stringify(procedure) !== JSON.stringify(procedureDocument())) {
    throw new Error("validation_procedure_projection_mismatch");
  }
}

function removeInterruptedTemporaryFiles(output: string): string[] {
  const removed: string[] = [];
  let visited = 0;
  const temporaryName = /^\.(?:session\.json|procedure\.json|manifest\.json|SHA256SUMS|result\.json)\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.rlsok-tmp$/i;
  const visit = (directory: string, depth: number): void => {
    if (depth > 4) throw new Error("validation_recovery_directory_depth_exceeded");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      visited += 1;
      if (visited > 160) throw new Error("validation_recovery_entry_limit_exceeded");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path, depth + 1);
      } else if (temporaryName.test(entry.name)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error("validation_recovery_temporary_entry_not_regular");
        }
        rmSync(path);
        removed.push(relative(output, path).replaceAll("\\", "/"));
      }
    }
  };
  visit(output, 0);
  return removed.sort();
}

function orphanStagingDirectories(output: string): string[] {
  const parent = dirname(output);
  const escaped = basename(output).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\.${escaped}\\.(?:${CASES.map((entry) => entry.id).join("|")})\\.[0-9a-f-]{36}\\.rlsok-staging$`,
    "i",
  );
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => join(parent, entry.name));
}

function recoverIncompleteSession(output: string): {
  status: "PENDING" | "COLLECTED";
  removedTemporaryFiles: string[];
  orphanStagingDirectories: string[];
} {
  assertOutputDirectory(output);
  const rawSessionBeforeMutation = readJsonObject(join(output, "session.json"), "validation_session");
  if (!isUuid(rawSessionBeforeMutation.sessionId)) {
    throw new Error("validation_recovery_session_id_invalid");
  }
  readSession(output, rawSessionBeforeMutation.sessionId);
  readProcedure(output);
  const removedTemporaryFiles = removeInterruptedTemporaryFiles(output);
  let oldManifest: ValidationManifest | undefined;
  if (existsSync(join(output, "manifest.json"))) {
    oldManifest = readJsonObject(
      join(output, "manifest.json"),
      "validation_recovery_manifest",
    ) as unknown as ValidationManifest;
    if (
      oldManifest.schema !== "rlsok.io/external-ros2-validation-manifest/v1" ||
      !["PENDING", "COLLECTED"].includes(oldManifest.status) ||
      !isUuid(oldManifest.sessionId) ||
      !Array.isArray(oldManifest.files)
    ) {
      throw new Error("validation_recovery_manifest_identity_invalid");
    }
  }
  const session = readSession(output, rawSessionBeforeMutation.sessionId);
  if (oldManifest && oldManifest.sessionId !== session.sessionId) {
    throw new Error("validation_recovery_manifest_session_mismatch");
  }

  const records: CaseRecord[] = [];
  const allowed = new Set(["session.json", "procedure.json"]);
  for (const definition of CASES) {
    const caseRoot = join(output, "cases", definition.id);
    if (!existsSync(caseRoot)) continue;
    const stat = lstatSync(caseRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`validation_recovery_case_directory_invalid:${definition.id}`);
    }
    if (!existsSync(join(caseRoot, "record.json"))) {
      throw new Error(`validation_recovery_partial_case:${definition.id}`);
    }
    const recordValue = readCase(output, definition, session);
    records.push(recordValue);
    allowed.add(`cases/${definition.id}/record.json`);
    for (const artifact of Object.values(recordValue.artifacts)) allowed.add(artifact.path);
  }

  let status: "PENDING" | "COLLECTED" = "PENDING";
  const resultPath = join(output, "result.json");
  if (existsSync(resultPath)) {
    const result = readJsonObject(resultPath, "validation_result");
    if (typeof result.completedAt !== "string") {
      throw new Error("validation_recovery_result_completed_at_invalid");
    }
    const completeRecords = collectCaseRecords(output, session);
    const expected = buildResult(output, session, completeRecords, result.completedAt);
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      throw new Error("validation_recovery_result_projection_mismatch");
    }
    status = "COLLECTED";
    allowed.add("result.json");
  } else if (oldManifest?.status === "COLLECTED") {
    throw new Error("validation_recovery_collected_result_missing");
  }

  const actual = filesBelow(output)
    .map((path) => relative(output, path).replaceAll("\\", "/"))
    .filter((path) => !["manifest.json", "SHA256SUMS"].includes(path));
  const unexpected = actual.filter((path) => !allowed.has(path));
  const missing = [...allowed].filter((path) => !actual.includes(path));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `validation_recovery_artifact_set_invalid:unexpected=${unexpected.join(",")}:missing=${missing.join(",")}`,
    );
  }
  writeManifest(output, status, session.sessionId);
  readVerifiedManifest(output, status);
  return {
    status,
    removedTemporaryFiles,
    orphanStagingDirectories: orphanStagingDirectories(output),
  };
}

function recover(options: Options): void {
  assertExactOptions(options, ["output"]);
  const output = resolve(required(options, "output"));
  const staleLockRemoved = clearDeadSessionLock(output);
  withSessionLock(output, () => {
    const recovered = recoverIncompleteSession(output);
    process.stdout.write(`${JSON.stringify({
      status: recovered.status,
      recovery: "COMPLETE",
      staleLockRemoved,
      removedTemporaryFiles: recovered.removedTemporaryFiles,
      orphanStagingDirectories: recovered.orphanStagingDirectories,
      output,
    })}\n`);
  });
}

function init(options: Options): void {
  assertExactOptions(options, ["output", "operator", "target"]);
  const output = resolve(required(options, "output"));
  const operator = safeText(required(options, "operator"), "operator");
  const target = safeText(required(options, "target"), "target");
  if (existsSync(output)) {
    const stat = lstatSync(output);
    if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(output).length > 0) {
      throw new Error("validation_output_must_be_new_empty_directory_or_absent");
    }
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(output, 0o700);
  assertOutputDirectory(output);
  const sessionId = randomUUID();
  writeProtected(join(output, "session.json"), {
    schema: "rlsok.io/external-ros2-validation-session/v1",
    sessionId,
    operator,
    target,
    createdAt: new Date().toISOString(),
    environment: {
      runtimeVersion: packageMetadata.version,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      rosDistro: process.env.ROS_DISTRO ?? null,
      rmwImplementation: process.env.RMW_IMPLEMENTATION ?? null,
      rosDomainId: process.env.ROS_DOMAIN_ID ?? null,
    },
  } satisfies ValidationSession);
  writeProtected(join(output, "procedure.json"), procedureDocument());
  writeManifest(output, "PENDING", sessionId);
  process.stdout.write(`${JSON.stringify({ status: "PENDING", sessionId, output })}\n`);
}

function record(options: Options): void {
  assertExactOptions(options, [
    "output", "case", "outcome", "reason", "command", "log", "invocation", "execution",
    "subject", "original-evidence-chain", "observer", "evidence", "cloud-evidence",
    "approval", "release-receipt", "runtime-log", "negative-result",
  ]);
  const output = resolve(required(options, "output"));
  const manifest = readVerifiedManifest(output, "PENDING");
  const session = readSession(output, manifest.sessionId);
  readProcedure(output);
  const caseId = required(options, "case") as CaseId;
  const definition = CASES.find((entry) => entry.id === caseId);
  if (!definition) throw new Error(`unknown_validation_case:${caseId}`);
  const outcome = required(options, "outcome") as ExpectedOutcome;
  if (!(["PASS", "BLOCK"] as const).includes(outcome)) throw new Error("case_outcome_invalid");
  if (outcome !== definition.expected) throw new Error("case_outcome_does_not_match_procedure");
  const reason = safeText(required(options, "reason"), "case_reason");
  assertCaseReason(caseId, reason);
  const caseRoot = join(output, "cases", caseId);
  if (existsSync(caseRoot)) throw new Error(`validation_case_already_recorded:${caseId}`);
  const commandSource = resolve(required(options, "command"));
  assertRegularFile(commandSource, "case_command", 64 * 1024);
  if (!readRegularFile(commandSource, "case_command", 64 * 1024).toString("utf8").trim()) throw new Error("case_command_empty");
  const commandSha256 = sha256File(commandSource);
  const logSource = resolve(required(options, "log"));
  assertRegularFile(logSource, "case_log", 32 * 1024 * 1024);
  const logSha256 = sha256File(logSource);
  const invocationSource = resolve(required(options, "invocation"));
  const invocation = parseInvocation(invocationSource, { session, caseId, commandSha256 });
  const invocationSha256 = sha256File(invocationSource);
  let subjectSource: string | undefined;
  if (definition.subject) {
    subjectSource = resolve(required(options, "subject"));
    assertRegularFile(
      subjectSource,
      "case_subject",
      caseId === "evidence_tamper" ? 32 * 1024 * 1024 : 16 * 1024 * 1024,
    );
    readCaseProposal(subjectSource, caseId);
  } else if (options.subject) {
    throw new Error("subject_not_expected_for_case");
  }
  let originalEvidenceChainSource: string | undefined;
  if (caseId === "evidence_tamper") {
    originalEvidenceChainSource = resolve(required(options, "original-evidence-chain"));
    assertEvidenceTamperPair(originalEvidenceChainSource, subjectSource!);
  } else if (options["original-evidence-chain"]) {
    throw new Error("original_evidence_chain_not_expected_for_case");
  }

  let observer: ZeroDispatchObserver | undefined;
  let observerSource: string | undefined;
  if (definition.observer) {
    observerSource = resolve(required(options, "observer"));
    observer = parseObserver(observerSource, {
      sessionId: manifest.sessionId,
      caseId,
      commandSha256,
      invocationSha256,
      invocationCapturedAt: invocation.capturedAt,
      sessionCreatedAt: session.createdAt,
    });
  } else if (options.observer) {
    throw new Error("observer_not_expected_for_case");
  }
  const observerSha256 = observerSource ? sha256File(observerSource) : null;
  const executionSource = resolve(required(options, "execution"));
  const execution = parseExecution(executionSource, {
    session,
    caseId,
    invocationSha256,
    commandSha256,
    commandLogSha256: logSha256,
    observerSha256,
  });
  const exitCode = execution.commandExitCode;
  if (exitCode !== definition.exitCode) throw new Error("case_exit_code_does_not_match_procedure");
  if (observer && (
    observer.commandStartedAt !== execution.commandStartedAt ||
    observer.commandFinishedAt !== execution.commandFinishedAt ||
    observer.commandPath !== invocation.environment.controllerAction
  )) {
    throw new Error("observer_execution_invocation_mismatch");
  }
  let runtimeLogSource: string | undefined;
  let negativeResultSource: string | undefined;
  let negativeResult: NegativeRuntimeResult | undefined;
  if (requiresNegativeRuntimeResult(caseId)) {
    runtimeLogSource = resolve(required(options, "runtime-log"));
    negativeResultSource = resolve(required(options, "negative-result"));
    negativeResult = parseNegativeRuntimeResult(
      negativeResultSource,
      runtimeLogSource,
      {
        sessionId: session.sessionId,
        caseId,
        reason,
        subjectSha256: sha256File(subjectSource!, "case_subject", 16 * 1024 * 1024),
        commandStartedAt: execution.commandStartedAt,
        commandFinishedAt: execution.commandFinishedAt,
      },
    );
  } else if (options["runtime-log"] || options["negative-result"]) {
    throw new Error("negative_runtime_result_not_expected_for_case");
  }

  let evidence: NormalizedEvidence | undefined;
  let evidenceSource: string | undefined;
  let cloudEvidenceSource: string | undefined;
  if (definition.evidence) {
    evidenceSource = resolve(required(options, "evidence"));
    cloudEvidenceSource = resolve(required(options, "cloud-evidence"));
    evidence = parseEvidence(evidenceSource, cloudEvidenceSource);
    if (evidence.decision !== expectedDecision(outcome) || evidence.reason !== reason) {
      throw new Error("evidence_decision_or_reason_mismatch");
    }
    const sourceProposal = subjectSource ? readCaseProposal(subjectSource, caseId) : null;
    if (
      !sourceProposal ||
      sourceProposal.proposalId !== evidence.proposalId ||
      sourceProposal.releaseId !== evidence.releaseId ||
      sourceProposal.deviceId !== evidence.deviceId ||
      proposalActionHash(sourceProposal) !== evidence.actionHash
    ) {
      throw new Error("evidence_did_not_bind_case_subject");
    }
  } else if (options.evidence) {
    throw new Error("evidence_not_expected_for_case");
  } else if (options["cloud-evidence"]) {
    throw new Error("cloud_evidence_not_expected_for_case");
  }

  let approval: ApprovalProof | undefined;
  let approvalSource: string | undefined;
  let releaseReceiptSource: string | undefined;
  if (definition.approval) {
    approvalSource = resolve(required(options, "approval"));
    releaseReceiptSource = resolve(required(options, "release-receipt"));
    approval = parseApproval(approvalSource, releaseReceiptSource, {
      sessionId: manifest.sessionId,
      sessionCreatedAt: session.createdAt,
    });
    if (
      !evidence ||
      approval.releaseId !== evidence.releaseId ||
      (evidence.executablePolicyHash !== null && approval.executablePolicyHash !== evidence.executablePolicyHash)
    ) {
      throw new Error("approval_did_not_bind_recorded_release");
    }
  } else if (options.approval) {
    throw new Error("approval_not_expected_for_case");
  } else if (options["release-receipt"]) {
    throw new Error("release_receipt_not_expected_for_case");
  }

  const stagingRoot = join(
    dirname(output),
    `.${basename(output)}.${caseId}.${randomUUID()}.rlsok-staging`,
  );
  mkdirSync(dirname(caseRoot), { recursive: true, mode: 0o700 });
  mkdirSync(stagingRoot, { mode: 0o700 });
  try {
    const command = copyProtected(commandSource, join(stagingRoot, "command.txt"), "case_command", 64 * 1024);
    const log = copyProtected(logSource, join(stagingRoot, "command.log"), "case_log", 32 * 1024 * 1024);
    const artifacts: CaseRecord["artifacts"] = {
      command: { path: `cases/${caseId}/command.txt`, sha256: command.sha256 },
      log: { path: `cases/${caseId}/command.log`, sha256: log.sha256 },
      invocation: {
        path: `cases/${caseId}/invocation.json`,
        sha256: copyProtected(invocationSource, join(stagingRoot, "invocation.json"), "command_invocation", 1024 * 1024).sha256,
      },
      execution: {
        path: `cases/${caseId}/execution.json`,
        sha256: copyProtected(executionSource, join(stagingRoot, "execution.json"), "command_execution", 1024 * 1024).sha256,
      },
    };
    if (subjectSource) {
      const copied = copyProtected(
        subjectSource,
        join(stagingRoot, "subject.bin"),
        "case_subject",
        caseId === "evidence_tamper" ? 32 * 1024 * 1024 : 16 * 1024 * 1024,
      );
      artifacts.subject = { path: `cases/${caseId}/subject.bin`, sha256: copied.sha256 };
    }
    if (originalEvidenceChainSource) {
      const copied = copyProtected(
        originalEvidenceChainSource,
        join(stagingRoot, "original-evidence-chain.json"),
        "original_evidence_chain",
        32 * 1024 * 1024,
      );
      artifacts.originalEvidenceChain = {
        path: `cases/${caseId}/original-evidence-chain.json`,
        sha256: copied.sha256,
      };
    }
    if (runtimeLogSource && negativeResultSource) {
      const runtimeLog = copyProtected(
        runtimeLogSource,
        join(stagingRoot, "runtime.log"),
        "negative_runtime_log",
        8 * 1024 * 1024,
      );
      const negative = copyProtected(
        negativeResultSource,
        join(stagingRoot, "negative-result.json"),
        "negative_runtime_result",
        64 * 1024,
      );
      artifacts.runtimeLog = { path: `cases/${caseId}/runtime.log`, sha256: runtimeLog.sha256 };
      artifacts.negativeResult = {
        path: `cases/${caseId}/negative-result.json`,
        sha256: negative.sha256,
      };
    }
    if (observerSource) {
      const copied = copyProtected(observerSource, join(stagingRoot, "observer.json"), "observer", 1024 * 1024);
      artifacts.observer = { path: `cases/${caseId}/observer.json`, sha256: copied.sha256 };
    }
    if (evidenceSource) {
      const copied = copyProtected(evidenceSource, join(stagingRoot, "evidence.json"), "evidence", 16 * 1024 * 1024);
      artifacts.evidence = { path: `cases/${caseId}/evidence.json`, sha256: copied.sha256 };
    }
    if (cloudEvidenceSource) {
      const copied = copyProtected(cloudEvidenceSource, join(stagingRoot, "cloud-evidence.json"), "cloud_evidence_receipt", 1024 * 1024);
      artifacts.cloudEvidence = { path: `cases/${caseId}/cloud-evidence.json`, sha256: copied.sha256 };
    }
    if (approvalSource) {
      const copied = copyProtected(approvalSource, join(stagingRoot, "approval.json"), "approval", 64 * 1024);
      artifacts.approval = { path: `cases/${caseId}/approval.json`, sha256: copied.sha256 };
    }
    if (releaseReceiptSource) {
      const copied = copyProtected(releaseReceiptSource, join(stagingRoot, "cloud-release.json"), "cloud_release_receipt", 1024 * 1024);
      artifacts.releaseReceipt = { path: `cases/${caseId}/cloud-release.json`, sha256: copied.sha256 };
    }

    const recordValue: CaseRecord = {
      schema: "rlsok.io/external-ros2-validation-case/v1",
      sessionId: manifest.sessionId,
      caseId,
      expectedOutcome: definition.expected,
      actualOutcome: outcome,
      reason,
      exitCode,
      recordedAt: new Date().toISOString(),
      artifacts,
      ...(observer ? { observer } : {}),
      ...(evidence ? { evidence } : {}),
      ...(approval ? { approval } : {}),
      ...(negativeResult ? { negativeResult } : {}),
    };
    writeProtected(join(stagingRoot, "record.json"), recordValue);
    renameSync(stagingRoot, caseRoot);
    fsyncParentDirectory(caseRoot);
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  writeManifest(output, "PENDING", manifest.sessionId);
  process.stdout.write(`${JSON.stringify({ status: "RECORDED", caseId, outcome })}\n`);
}

function readCase(
  output: string,
  definition: (typeof CASES)[number],
  session: ValidationSession,
): CaseRecord {
  const path = join(output, "cases", definition.id, "record.json");
  const rawRecord = readJsonObject(path, `validation_case:${definition.id}`);
  assertExactObjectKeys(rawRecord, [
    "schema", "sessionId", "caseId", "expectedOutcome", "actualOutcome", "reason",
    "exitCode", "recordedAt", "artifacts",
    ...(definition.observer ? ["observer"] : []),
    ...(definition.evidence ? ["evidence"] : []),
    ...(definition.approval ? ["approval"] : []),
    ...(requiresNegativeRuntimeResult(definition.id) ? ["negativeResult"] : []),
  ], `validation_case:${definition.id}`);
  const recordValue = rawRecord as unknown as CaseRecord;
  if (
    recordValue.schema !== "rlsok.io/external-ros2-validation-case/v1" ||
    recordValue.sessionId !== session.sessionId ||
    recordValue.caseId !== definition.id ||
    recordValue.expectedOutcome !== definition.expected ||
    recordValue.actualOutcome !== definition.expected ||
    !Number.isInteger(recordValue.exitCode) ||
    recordValue.exitCode !== definition.exitCode
  ) {
    throw new Error(`validation_case_invalid:${definition.id}`);
  }
  if (typeof recordValue.reason !== "string" || !recordValue.reason) {
    throw new Error(`validation_case_reason_invalid:${definition.id}`);
  }
  assertCaseReason(definition.id, recordValue.reason);
  const recordedAt = timestamp(recordValue.recordedAt, `validation_case_recorded_at:${definition.id}`);
  if (
    recordedAt < timestamp(session.createdAt, "validation_session_created_at") ||
    recordedAt > Date.now() + 60_000
  ) {
    throw new Error(`validation_case_recorded_at_out_of_range:${definition.id}`);
  }
  const expectedArtifacts: Record<string, string> = {
    command: `cases/${definition.id}/command.txt`,
    log: `cases/${definition.id}/command.log`,
    invocation: `cases/${definition.id}/invocation.json`,
    execution: `cases/${definition.id}/execution.json`,
    ...(definition.subject ? { subject: `cases/${definition.id}/subject.bin` } : {}),
    ...(definition.id === "evidence_tamper"
      ? { originalEvidenceChain: `cases/${definition.id}/original-evidence-chain.json` }
      : {}),
    ...(requiresNegativeRuntimeResult(definition.id)
      ? {
          runtimeLog: `cases/${definition.id}/runtime.log`,
          negativeResult: `cases/${definition.id}/negative-result.json`,
        }
      : {}),
    ...(definition.observer ? { observer: `cases/${definition.id}/observer.json` } : {}),
    ...(definition.evidence ? { evidence: `cases/${definition.id}/evidence.json` } : {}),
    ...(definition.evidence ? { cloudEvidence: `cases/${definition.id}/cloud-evidence.json` } : {}),
    ...(definition.approval ? { approval: `cases/${definition.id}/approval.json` } : {}),
    ...(definition.approval ? { releaseReceipt: `cases/${definition.id}/cloud-release.json` } : {}),
  };
  if (!recordValue.artifacts || typeof recordValue.artifacts !== "object") {
    throw new Error(`validation_case_artifacts_missing:${definition.id}`);
  }
  const artifactEntries = Object.entries(recordValue.artifacts);
  if (
    artifactEntries.length !== Object.keys(expectedArtifacts).length ||
    artifactEntries.some(([name]) => !Object.prototype.hasOwnProperty.call(expectedArtifacts, name))
  ) {
    throw new Error(`validation_case_artifact_set_invalid:${definition.id}`);
  }
  for (const [name, artifact] of artifactEntries) {
    if (
      !artifact ||
      typeof artifact.path !== "string" ||
      artifact.path !== expectedArtifacts[name] ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      throw new Error(`validation_case_artifact_invalid:${definition.id}`);
    }
    const artifactPath = join(output, ...artifact.path.split("/"));
    assertRegularFile(artifactPath, `validation_case_artifact:${definition.id}`);
    if (sha256File(artifactPath) !== artifact.sha256) {
      throw new Error(`validation_case_artifact_hash_mismatch:${definition.id}`);
    }
  }
  const proposal = definition.subject
    ? readCaseProposal(
        join(output, ...recordValue.artifacts.subject!.path.split("/")),
        definition.id,
      )
    : null;
  if (definition.id === "evidence_tamper") {
    assertEvidenceTamperPair(
      join(output, ...recordValue.artifacts.originalEvidenceChain!.path.split("/")),
      join(output, ...recordValue.artifacts.subject!.path.split("/")),
    );
  }
  const invocation = parseInvocation(
    join(output, ...recordValue.artifacts.invocation.path.split("/")),
    {
      session,
      caseId: definition.id,
      commandSha256: recordValue.artifacts.command.sha256,
    },
  );
  if (proposal) {
    const createdAt = timestamp(proposal.createdAt, `proposal_created_at:${definition.id}`);
    if (
      createdAt < timestamp(session.createdAt, "validation_session_created_at") ||
      createdAt > (definition.id === "setup_zero_to_shadow"
        ? recordedAt
        : timestamp(invocation.capturedAt, "command_invocation_captured_at"))
    ) {
      throw new Error(`validation_case_proposal_time_invalid:${definition.id}`);
    }
  }
  if (definition.observer) {
    if (!recordValue.observer || !recordValue.artifacts.observer) throw new Error(`validation_case_observer_missing:${definition.id}`);
    const reparsed = parseObserver(
      join(output, ...recordValue.artifacts.observer.path.split("/")),
      {
        sessionId: session.sessionId,
        caseId: definition.id,
        commandSha256: recordValue.artifacts.command.sha256,
        invocationSha256: recordValue.artifacts.invocation.sha256,
        invocationCapturedAt: invocation.capturedAt,
        sessionCreatedAt: session.createdAt,
      },
    );
    if (JSON.stringify(reparsed) !== JSON.stringify(recordValue.observer)) {
      throw new Error(`validation_case_observer_projection_mismatch:${definition.id}`);
    }
    if (timestamp(reparsed.settleFinishedAt, "observer_settle_finished_at") > recordedAt) {
      throw new Error(`validation_case_recorded_before_observer_settled:${definition.id}`);
    }
  } else if (recordValue.observer !== undefined) {
    throw new Error(`validation_case_unexpected_observer:${definition.id}`);
  }
  const execution = parseExecution(
    join(output, ...recordValue.artifacts.execution.path.split("/")),
    {
      session,
      caseId: definition.id,
      invocationSha256: recordValue.artifacts.invocation.sha256,
      commandSha256: recordValue.artifacts.command.sha256,
      commandLogSha256: recordValue.artifacts.log.sha256,
      observerSha256: recordValue.artifacts.observer?.sha256 ?? null,
    },
  );
  if (requiresNegativeRuntimeResult(definition.id)) {
    if (!recordValue.negativeResult || !recordValue.artifacts.runtimeLog || !recordValue.artifacts.negativeResult) {
      throw new Error(`validation_case_negative_runtime_result_missing:${definition.id}`);
    }
    const reparsed = parseNegativeRuntimeResult(
      join(output, ...recordValue.artifacts.negativeResult.path.split("/")),
      join(output, ...recordValue.artifacts.runtimeLog.path.split("/")),
      {
        sessionId: session.sessionId,
        caseId: definition.id,
        reason: recordValue.reason,
        subjectSha256: recordValue.artifacts.subject!.sha256,
        commandStartedAt: execution.commandStartedAt,
        commandFinishedAt: execution.commandFinishedAt,
      },
    );
    if (JSON.stringify(reparsed) !== JSON.stringify(recordValue.negativeResult)) {
      throw new Error(`validation_case_negative_runtime_projection_mismatch:${definition.id}`);
    }
  } else if (recordValue.negativeResult !== undefined) {
    throw new Error(`validation_case_unexpected_negative_runtime_result:${definition.id}`);
  }
  if (
    execution.commandExitCode !== recordValue.exitCode ||
    (recordValue.observer && (
      recordValue.observer.commandStartedAt !== execution.commandStartedAt ||
      recordValue.observer.commandFinishedAt !== execution.commandFinishedAt ||
      recordValue.observer.commandPath !== invocation.environment.controllerAction
    )) ||
    timestamp(execution.commandFinishedAt, "command_execution_finished_at") > recordedAt
  ) {
    throw new Error(`validation_case_execution_projection_mismatch:${definition.id}`);
  }
  if (
    definition.subject && !["setup_zero_to_shadow", "evidence_tamper"].includes(definition.id) &&
    invocation.environment.proposalSha256 !== recordValue.artifacts.subject!.sha256
  ) {
    throw new Error(`validation_case_invocation_subject_mismatch:${definition.id}`);
  }
  if (definition.evidence) {
    if (!recordValue.evidence || !recordValue.artifacts.evidence || !recordValue.artifacts.cloudEvidence) throw new Error(`validation_case_evidence_missing:${definition.id}`);
    const reparsed = parseEvidence(
      join(output, ...recordValue.artifacts.evidence.path.split("/")),
      join(output, ...recordValue.artifacts.cloudEvidence.path.split("/")),
    );
    if (JSON.stringify(reparsed) !== JSON.stringify(recordValue.evidence)) {
      throw new Error(`validation_case_evidence_projection_mismatch:${definition.id}`);
    }
    if (
      reparsed.decision !== expectedDecision(recordValue.actualOutcome) ||
      reparsed.reason !== recordValue.reason
    ) {
      throw new Error(`validation_case_evidence_decision_mismatch:${definition.id}`);
    }
    if (
      !proposal ||
      proposal.proposalId !== reparsed.proposalId ||
      proposal.releaseId !== reparsed.releaseId ||
      proposal.deviceId !== reparsed.deviceId ||
      proposalActionHash(proposal) !== reparsed.actionHash
    ) {
      throw new Error(`validation_case_subject_proposal_mismatch:${definition.id}`);
    }
    const evidenceAt = timestamp(
      reparsed.cloudEvidenceCreatedAt,
      `cloud_evidence_created_at:${definition.id}`,
    );
    if (
      evidenceAt < timestamp(execution.commandStartedAt, "command_execution_started_at") - MAX_EXTERNAL_CLOCK_SKEW_MS ||
      evidenceAt > timestamp(execution.commandFinishedAt, "command_execution_finished_at") + MAX_EXTERNAL_CLOCK_SKEW_MS
    ) {
      throw new Error(`validation_case_evidence_time_invalid:${definition.id}`);
    }
  } else if (recordValue.evidence !== undefined) {
    throw new Error(`validation_case_unexpected_evidence:${definition.id}`);
  }
  if (definition.approval) {
    if (!recordValue.approval || !recordValue.artifacts.approval || !recordValue.artifacts.releaseReceipt) throw new Error(`validation_case_approval_missing:${definition.id}`);
    const reparsed = parseApproval(
      join(output, ...recordValue.artifacts.approval.path.split("/")),
      join(output, ...recordValue.artifacts.releaseReceipt.path.split("/")),
      { sessionId: session.sessionId, sessionCreatedAt: session.createdAt },
    );
    if (JSON.stringify(reparsed) !== JSON.stringify(recordValue.approval)) {
      throw new Error(`validation_case_approval_projection_mismatch:${definition.id}`);
    }
    const approvalAt = timestamp(reparsed.approvedAt, "approval_approved_at");
    if (
      approvalAt < timestamp(execution.commandStartedAt, "command_execution_started_at") - MAX_EXTERNAL_CLOCK_SKEW_MS ||
      approvalAt > timestamp(execution.commandFinishedAt, "command_execution_finished_at") + MAX_EXTERNAL_CLOCK_SKEW_MS
    ) {
      throw new Error(`validation_case_approval_time_invalid:${definition.id}`);
    }
  } else if (recordValue.approval !== undefined) {
    throw new Error(`validation_case_unexpected_approval:${definition.id}`);
  }
  return recordValue;
}

function collectCaseRecords(output: string, session: ValidationSession): CaseRecord[] {
  return CASES
    .filter((definition) => {
      const present = existsSync(join(output, "cases", definition.id, "record.json"));
      if (definition.required && !present) {
        throw new Error(`required_validation_case_missing:${definition.id}`);
      }
      return present;
    })
    .map((definition) => readCase(output, definition, session));
}

function assertCrossCaseBindings(
  output: string,
  session: ValidationSession,
  records: CaseRecord[],
): {
  releaseId: string;
  executablePolicyHash: string;
} {
  const setup = records.find((entry) => entry.caseId === "setup_zero_to_shadow")!;
  if (!setup.approval || !setup.evidence) throw new Error("setup_approval_or_evidence_missing");
  const releaseId = setup.approval.releaseId;
  const executablePolicyHash = setup.approval.executablePolicyHash;
  const setupProposal = readCaseProposal(
    join(output, ...setup.artifacts.subject!.path.split("/")),
    "setup_zero_to_shadow",
  )!;
  const invocationFor = (recordValue: CaseRecord): CommandInvocation => parseInvocation(
    join(output, ...recordValue.artifacts.invocation.path.split("/")),
    {
      session,
      caseId: recordValue.caseId,
      commandSha256: recordValue.artifacts.command.sha256,
    },
  );
  const setupInvocation = invocationFor(setup);
  const stableRuntime = {
    path: setupInvocation.environment.runtimeBinary,
    sha256: setupInvocation.environment.runtimeBinarySha256,
    version: setupInvocation.environment.runtimeVersion,
    controllerAction: setupInvocation.environment.controllerAction,
    jointStateTopic: setupInvocation.environment.jointStateTopic,
    joints: setupInvocation.environment.joints,
  };
  for (const recordValue of records) {
    const candidate = invocationFor(recordValue).environment;
    if (
      candidate.runtimeBinary !== stableRuntime.path ||
      candidate.runtimeBinarySha256 !== stableRuntime.sha256 ||
      candidate.runtimeVersion !== stableRuntime.version ||
      candidate.controllerAction !== stableRuntime.controllerAction ||
      candidate.jointStateTopic !== stableRuntime.jointStateTopic ||
      JSON.stringify(candidate.joints) !== JSON.stringify(stableRuntime.joints)
    ) {
      throw new Error(`validation_runtime_or_ros_binding_changed:${recordValue.caseId}`);
    }
  }
  const postSetupInvocations = records
    .filter((entry) => !["clean_install", "setup_zero_to_shadow"].includes(entry.caseId))
    .map((entry) => ({ caseId: entry.caseId, environment: invocationFor(entry).environment }));
  const firstPostSetup = postSetupInvocations[0]?.environment;
  if (
    !firstPostSetup || firstPostSetup.setupPath === null || firstPostSetup.setupStateSha256 === null ||
    firstPostSetup.cloudBaseUrl === null || setupInvocation.environment.cloudBaseUrl === null ||
    setupInvocation.environment.cloudBaseUrl !== firstPostSetup.cloudBaseUrl
  ) {
    throw new Error("validation_post_setup_provenance_missing");
  }
  for (const candidate of postSetupInvocations) {
    if (
      candidate.environment.setupPath !== firstPostSetup.setupPath ||
      candidate.environment.setupStateSha256 !== firstPostSetup.setupStateSha256 ||
      candidate.environment.cloudBaseUrl !== firstPostSetup.cloudBaseUrl
    ) {
      throw new Error(`validation_setup_or_cloud_binding_changed:${candidate.caseId}`);
    }
  }
  const releaseReceipt = readJsonObject(
    join(output, ...setup.artifacts.releaseReceipt!.path.split("/")),
    "setup_cloud_release_receipt",
  );
  const releaseSpec = executablePolicySpecSchema.parse(releaseReceipt.execSpec);
  const releaseExpiresAt = timestamp(releaseSpec.deployment.expiresAt, "release_expires_at");
  if (
    setupInvocation.environment.policyArtifactSha256 !== releaseSpec.model.sha256 ||
    !releaseSpec.deployment.allowedDeviceIds.includes(setupProposal.deviceId) ||
    releaseSpec.deployment.mode !== "shadow" ||
    releaseSpec.approvedConfigurationDigest !== setup.evidence.expectedConfigurationDigest ||
    releaseSpec.robot.controllerConfigSha256 !== setup.evidence.controllerId ||
    releaseSpec.actionContract.representation !== setupProposal.actionPayload.representation ||
    releaseSpec.actionContract.dimension !== setupProposal.actionPayload.jointNames.length ||
    JSON.stringify(releaseSpec.actionContract.jointOrder) !== JSON.stringify(setupProposal.actionPayload.jointNames)
  ) {
    throw new Error("setup_release_did_not_bind_policy_device_controller_configuration_and_action");
  }
  for (const recordValue of records.filter((entry) => entry.caseId !== "clean_install")) {
    const execution = parseExecution(
      join(output, ...recordValue.artifacts.execution.path.split("/")),
      {
        session,
        caseId: recordValue.caseId,
        invocationSha256: recordValue.artifacts.invocation.sha256,
        commandSha256: recordValue.artifacts.command.sha256,
        commandLogSha256: recordValue.artifacts.log.sha256,
        observerSha256: recordValue.artifacts.observer?.sha256 ?? null,
      },
    );
    if (timestamp(execution.commandFinishedAt, "command_execution_finished_at") > releaseExpiresAt) {
      throw new Error(`validation_case_executed_after_release_expiry:${recordValue.caseId}`);
    }
  }
  const staleObserver = records.find((entry) => entry.caseId === "stale_state")!.observer!;
  if (
    staleObserver.statePausedAt === null ||
    timestamp(staleObserver.commandFinishedAt, "stale_command_finished_at") -
      timestamp(staleObserver.statePausedAt, "stale_state_paused_at") <=
        releaseSpec.runtimePolicy.maxStateAgeMs
  ) {
    throw new Error("stale_state_pause_did_not_exceed_release_freshness_bound");
  }
  if (
    setup.evidence.decision !== "allowed" ||
    setup.evidence.expectedConfigurationDigest !== setup.evidence.observedConfigurationDigest ||
    timestamp(setup.approval.approvedAt, "approval_approved_at") >
      timestamp(setup.evidence.cloudEvidenceCreatedAt, "setup_cloud_evidence_created_at")
  ) {
    throw new Error("setup_evidence_did_not_follow_exact_approval_and_configuration");
  }
  const cloudEvidenceIds = new Set<string>();
  const cloudEvidenceSequences = new Set<number>();
  const cloudPermitIds = new Set<string>();
  const chronologicalEvidence = records
    .filter((entry) => entry.evidence)
    .sort((left, right) => left.evidence!.cloudEvidenceSequence - right.evidence!.cloudEvidenceSequence);
  let previousEvidence: NormalizedEvidence | undefined;
  for (const recordValue of chronologicalEvidence) {
    if (recordValue.evidence!.releaseId !== releaseId) {
      throw new Error(`validation_release_identity_changed:${recordValue.caseId}`);
    }
    if (recordValue.evidence!.executablePolicyHash !== executablePolicyHash) {
      throw new Error(`validation_release_content_changed:${recordValue.caseId}`);
    }
    if (
      recordValue.evidence!.deviceId !== setup.evidence.deviceId ||
      recordValue.evidence!.controllerId !== setup.evidence.controllerId ||
      recordValue.evidence!.expectedConfigurationDigest !==
        setup.evidence.expectedConfigurationDigest
    ) {
      throw new Error(`validation_execution_binding_changed:${recordValue.caseId}`);
    }
    if (
      cloudEvidenceIds.has(recordValue.evidence!.cloudEvidenceId) ||
      cloudEvidenceSequences.has(recordValue.evidence!.cloudEvidenceSequence)
    ) {
      throw new Error("cloud_evidence_receipt_reused_across_validation_cases");
    }
    cloudEvidenceIds.add(recordValue.evidence!.cloudEvidenceId);
    cloudEvidenceSequences.add(recordValue.evidence!.cloudEvidenceSequence);
    if (recordValue.evidence!.cloudPermitId !== null) {
      if (cloudPermitIds.has(recordValue.evidence!.cloudPermitId)) {
        throw new Error("cloud_permit_reused_across_validation_cases");
      }
      cloudPermitIds.add(recordValue.evidence!.cloudPermitId);
    }
    if (
      recordValue.evidence!.cloudEvidenceSequence === 0 &&
      recordValue.evidence!.cloudEvidencePreviousHash !== null
    ) {
      throw new Error("cloud_evidence_genesis_previous_hash_invalid");
    }
    if (
      recordValue.evidence!.cloudEvidenceSequence > 0 &&
      recordValue.evidence!.cloudEvidencePreviousHash === null
    ) {
      throw new Error("cloud_evidence_non_genesis_previous_hash_missing");
    }
    if (previousEvidence) {
      if (
        recordValue.evidence!.cloudEvidenceSequence <= previousEvidence.cloudEvidenceSequence ||
        timestamp(recordValue.evidence!.cloudEvidenceCreatedAt, "cloud_evidence_created_at") <
          timestamp(previousEvidence.cloudEvidenceCreatedAt, "cloud_evidence_created_at")
      ) {
        throw new Error("cloud_evidence_lifecycle_not_monotonic");
      }
      if (
        recordValue.evidence!.cloudEvidenceSequence === previousEvidence.cloudEvidenceSequence + 1 &&
        recordValue.evidence!.cloudEvidencePreviousHash !== previousEvidence.cloudEvidenceHash
      ) {
        throw new Error("cloud_evidence_adjacent_chain_link_invalid");
      }
    }
    previousEvidence = recordValue.evidence!;
  }
  const proposalIds = new Set<string>();
  for (const recordValue of records) {
    if (!recordValue.artifacts.subject || ["malformed_input", "evidence_tamper"].includes(recordValue.caseId)) continue;
    const proposal = readCaseProposal(
      join(output, ...recordValue.artifacts.subject.path.split("/")),
      recordValue.caseId,
    )!;
    if (
      proposal.releaseId !== setupProposal.releaseId ||
      proposal.deviceId !== setupProposal.deviceId ||
      proposal.proposerIdentity !== setupProposal.proposerIdentity ||
      proposalActionHash(proposal) !== proposalActionHash(setupProposal)
    ) {
      throw new Error(`validation_proposal_binding_changed:${recordValue.caseId}`);
    }
    if (recordValue.caseId === "duplicate_replay") {
      if (proposal.proposalId !== setupProposal.proposalId) {
        throw new Error("duplicate_replay_did_not_reuse_original_proposal_id");
      }
    } else {
      if (proposalIds.has(proposal.proposalId)) {
        throw new Error(`validation_proposal_id_reused:${recordValue.caseId}`);
      }
      proposalIds.add(proposal.proposalId);
    }
  }
  const duplicate = records.find((entry) => entry.caseId === "duplicate_replay")!.evidence!;
  if (duplicate.proposalId !== setup.evidence.proposalId) {
    throw new Error("duplicate_replay_did_not_reuse_original_proposal_id");
  }
  if (
    duplicate.actionHash !== setup.evidence.actionHash ||
    duplicate.cloudPermitId !== null ||
    duplicate.cloudPermitConsumed ||
    duplicate.cloudPermitConsumptionState !== "not_consumed" ||
    duplicate.localPermitConsumed
  ) {
    throw new Error("duplicate_replay_evidence_semantics_invalid");
  }
  const restarted = records.find((entry) => entry.caseId === "restart_shadow")!.evidence!;
  if (restarted.proposalId === setup.evidence.proposalId) {
    throw new Error("restart_shadow_requires_fresh_proposal_id");
  }
  if (restarted.expectedConfigurationDigest !== restarted.observedConfigurationDigest) {
    throw new Error("restart_shadow_configuration_not_current");
  }
  const revoked = records.find((entry) => entry.caseId === "revoked_release")!.evidence!;
  if (
    revoked.cloudPermitId !== null ||
    revoked.cloudPermitConsumed ||
    revoked.cloudPermitConsumptionState !== "not_consumed" ||
    revoked.localPermitConsumed ||
    revoked.cloudEvidenceSequence <= setup.evidence.cloudEvidenceSequence ||
    timestamp(revoked.cloudEvidenceCreatedAt, "revoked_cloud_evidence_created_at") <=
      timestamp(setup.evidence.cloudEvidenceCreatedAt, "setup_cloud_evidence_created_at")
  ) {
    throw new Error("revocation_evidence_lifecycle_invalid");
  }
  const configuration = records.find((entry) => entry.caseId === "configuration_drift")!.evidence!;
  if (
    configuration.observedConfigurationDigest === null ||
    configuration.observedConfigurationDigest === configuration.expectedConfigurationDigest ||
    configuration.cloudPermitId !== null ||
    configuration.cloudPermitConsumed ||
    configuration.cloudPermitConsumptionState !== "not_consumed" ||
    configuration.localPermitConsumed
  ) {
    throw new Error("configuration_drift_evidence_semantics_invalid");
  }
  const tamperRecord = records.find((entry) => entry.caseId === "evidence_tamper")!;
  const tamperPair = assertEvidenceTamperPair(
    join(output, ...tamperRecord.artifacts.originalEvidenceChain!.path.split("/")),
    join(output, ...tamperRecord.artifacts.subject!.path.split("/")),
  );
  if (tamperPair.original.releaseFilter !== releaseId) {
    throw new Error("evidence_tamper_chain_release_filter_mismatch");
  }
  const exportedById = new Map(
    tamperPair.original.records.map((entry) => [entry.id, entry] as const),
  );
  for (const recordValue of records.filter((entry) => entry.evidence)) {
    const evidence = recordValue.evidence!;
    const exported = exportedById.get(evidence.cloudEvidenceId);
    if (
      !exported ||
      exported.sequence !== evidence.cloudEvidenceSequence ||
      exported.releaseId !== evidence.releaseId ||
      exported.permitId !== evidence.cloudPermitId ||
      exported.decision !== evidence.decision ||
      exported.hardwareSignalSent !== false ||
      exported.previousHash !== evidence.cloudEvidencePreviousHash ||
      exported.evidenceHash !== evidence.cloudEvidenceHash ||
      exported.createdAt !== evidence.cloudEvidenceCreatedAt ||
      exported.organizationFingerprint !== tamperPair.original.organizationFingerprint ||
      exported.includedForReleaseFilter !== true ||
      exported.payload.contractVersion !== cloudContractVersion ||
      exported.payload.contentHash !== evidence.executablePolicyHash ||
      exported.payload.actionHash !== evidence.actionHash ||
      exported.payload.deviceId !== evidence.deviceId ||
      exported.payload.controllerId !== evidence.controllerId ||
      exported.payload.expectedConfigurationDigest !== evidence.expectedConfigurationDigest ||
      exported.payload.observedConfigurationDigest !== evidence.observedConfigurationDigest ||
      exported.payload.localPermitConsumed !== evidence.localPermitConsumed ||
      exported.payload.cloudPermitConsumptionState !== evidence.cloudPermitConsumptionState ||
      exported.payload.controllerGoalsAttempted !== 0 ||
      exported.payload.reason !== evidence.reason
    ) {
      throw new Error(`evidence_tamper_export_did_not_bind_case_receipt:${recordValue.caseId}`);
    }
  }
  const setupSubject = setup.artifacts.subject!.sha256;
  const duplicateRecord = records.find((entry) => entry.caseId === "duplicate_replay")!;
  if (duplicateRecord.artifacts.subject!.sha256 !== setupSubject) {
    throw new Error("duplicate_replay_did_not_reuse_exact_proposal_bytes");
  }
  const restartRecord = records.find((entry) => entry.caseId === "restart_shadow")!;
  if (restartRecord.artifacts.subject!.sha256 === setupSubject) {
    throw new Error("restart_shadow_requires_fresh_proposal_bytes");
  }
  const observed = records.filter((entry) => entry.observer);
  const instanceIds = new Set(observed.map((entry) => entry.observer!.observerInstanceId));
  const nonces = new Set(observed.map((entry) => entry.observer!.nonce));
  if (instanceIds.size !== observed.length || nonces.size !== observed.length) {
    throw new Error("observer_proof_reused_across_validation_cases");
  }
  if (new Set(observed.map((entry) => entry.observer!.commandPath)).size !== 1) {
    throw new Error("observer_command_path_changed_across_validation_cases");
  }
  return { releaseId, executablePolicyHash };
}

function buildResult(
  output: string,
  session: ValidationSession,
  records: CaseRecord[],
  completedAt: string,
): ExternalValidationResult {
  const completedTime = timestamp(completedAt, "validation_completed_at");
  const latestRecord = Math.max(...records.map((entry) => timestamp(entry.recordedAt, "validation_case_recorded_at")));
  if (
    completedTime < timestamp(session.createdAt, "validation_session_created_at") ||
    completedTime < latestRecord ||
    completedTime > Date.now() + 60_000
  ) {
    throw new Error("validation_completed_at_out_of_range");
  }
  const { releaseId, executablePolicyHash } = assertCrossCaseBindings(output, session, records);
  return {
    schema: "rlsok.io/external-ros2-validation-result/v1",
    status: "COLLECTED_SELF_ATTESTED",
    reviewStatus: "EXTERNAL_REVIEW_REQUIRED",
    sessionId: session.sessionId,
    operator: session.operator,
    target: session.target,
    releaseId,
    executablePolicyHash,
    completedAt,
    assurance: {
      artifactIntegrity: "PASS",
      evidenceInternalConsistency: "PASS",
      cloudEvidenceAuthenticity: "SELF_ATTESTED",
      cloudEvidenceChainContinuity: "EXTERNAL_REVIEW_REQUIRED",
      observerAndEnvironmentAuthenticity: "SELF_ATTESTED",
      independentApprovalAuthenticity: "SELF_ATTESTED",
    },
    cases: records.map((entry) => ({
      caseId: entry.caseId,
      outcome: entry.actualOutcome,
      reason: entry.reason,
      exitCode: entry.exitCode,
      evidenceVerified: entry.evidence?.evidenceVerified ?? null,
      zeroDispatchSelfAttestationChecked: entry.observer ? true : null,
    })),
    limitations: [
      "Local hashes detect later changes only after SHA256SUMS is anchored outside this writable directory; they are not a signature.",
      "Observer, environment, operator, and approval identity are self-attested inputs that require an independent reviewer or authenticated external record.",
      "This observer covers the FollowJointTrajectory goal-request path only; its accepted-goal cancel callback is not raw CancelGoal service instrumentation, and it does not establish functional safety, unrelated endpoint silence, or physical Run readiness.",
      "Cloud Evidence v1 does not authenticate proposal bytes/proposalId or expose a server-authoritative Permit-consumption receipt; those local bindings remain external Cloud contract gates.",
      "The Evidence export can contain organization-wide chain records outside the release filter and must come from a dedicated validation organization before transfer.",
      "Collector recovery repairs local artifacts only; it does not reap processes that escape the command process group or survive a host crash.",
      "Generic ROS validation does not claim runtime-attestation drift or continuity-token transition coverage because the current CLI supplies no authenticated attestation provider.",
    ],
  };
}

function finalize(options: Options): void {
  assertExactOptions(options, ["output"]);
  const output = resolve(required(options, "output"));
  const manifest = readVerifiedManifest(output, "PENDING");
  const session = readSession(output, manifest.sessionId);
  readProcedure(output);
  const records = collectCaseRecords(output, session);
  const result = buildResult(output, session, records, new Date().toISOString());
  writeProtected(join(output, "result.json"), result);
  writeManifest(output, "COLLECTED", manifest.sessionId);
  process.stdout.write(`${JSON.stringify({ status: result.status, reviewStatus: result.reviewStatus, sessionId: manifest.sessionId, output })}\n`);
}

function verify(options: Options): void {
  assertExactOptions(options, ["output"]);
  const output = resolve(required(options, "output"));
  const manifest = readVerifiedManifest(output, "COLLECTED");
  const session = readSession(output, manifest.sessionId);
  readProcedure(output);
  const result = readJsonObject(join(output, "result.json"), "validation_result");
  const completedAt = result.completedAt;
  if (typeof completedAt !== "string") throw new Error("validation_result_completed_at_invalid");
  const records = collectCaseRecords(output, session);
  const expected = buildResult(output, session, records, completedAt);
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    throw new Error("validation_result_projection_mismatch");
  }
  process.stdout.write(`${JSON.stringify({ status: expected.status, reviewStatus: expected.reviewStatus, sessionId: manifest.sessionId, output })}\n`);
}

export function externalRos2ValidationUsage(): string {
  return [
    "usage:",
    "  rlsok validate-external-ros2 init --output <new-directory> --operator <id> --target <description>",
    "  rlsok validate-external-ros2 record --output <directory> --case <id> --outcome PASS|BLOCK --reason <exact-reason> --command <file> --log <file> --invocation <json> --execution <json> [--subject <file>] [--runtime-log <file> --negative-result <json>] [--original-evidence-chain <json>] [--observer <json>] [--evidence <local-json> --cloud-evidence <receipt-json>] [--approval <json> --release-receipt <cloud-release-json>]",
    "  rlsok validate-external-ros2 finalize --output <directory>",
    "  rlsok validate-external-ros2 verify --output <directory>",
    "  rlsok validate-external-ros2 recover --output <directory>  # only after the interrupted owner process has exited",
    "",
    `Required cases: ${CASES.filter((entry) => entry.required).map((entry) => entry.id).join(", ")}`,
    "Final status is COLLECTED_SELF_ATTESTED / EXTERNAL_REVIEW_REQUIRED, never an authenticated external PASS.",
  ].join("\n");
}

export async function runExternalRos2ValidationCommand(args: string[]): Promise<number> {
  const [operation, ...rest] = args;
  if (operation === "help" || operation === "--help") {
    process.stdout.write(`${externalRos2ValidationUsage()}\n`);
    return 0;
  }
  const options = parseOptions(rest);
  if (!operation || !["init", "record", "finalize", "verify", "recover"].includes(operation)) {
    throw new Error(`unknown validate-external-ros2 operation '${operation ?? ""}'`);
  }
  if (operation === "recover") {
    recover(options);
    return 0;
  }
  const output = resolve(required(options, "output"));
  withSessionLock(output, () => {
    if (operation === "init") init(options);
    else if (operation === "record") record(options);
    else if (operation === "finalize") finalize(options);
    else if (operation === "verify") verify(options);
  });
  return 0;
}

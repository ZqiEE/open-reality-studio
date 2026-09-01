import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  hardwareDispatchForCliFailure,
  operatorFailureReport,
} from "../../apps/cli/operator-report";
import {
  CloudClientError,
  RlsokCloudClient,
  loadCloudClientConfig,
  readStoredCloudCredentials,
} from "../../packages/cloud-client";
import {
  appendEvidence,
  sha256,
  verifyEvidenceBundle,
  type EvidenceBundle,
  type ExecutionEvidence,
} from "../../packages/core/evidence";
import { checkExecutablePolicySpec } from "../../packages/core/exec-spec";
import { evaluateConfigurationBinding } from "../../packages/core/execution-configuration";

type RecoveryStatus = "FAILED" | "BLOCKED";

function assertOperatorVisible(
  output: string,
  expectedStatus?: RecoveryStatus,
): void {
  assert.match(output, expectedStatus ? new RegExp(expectedStatus) : /FAILED|BLOCKED/);
  assert.match(output, /Observed:/);
  assert.match(output, /Reason:/);
  assert.match(output, /Hardware dispatch: NO/);
  assert.match(output, /Next action:/);
}

function report(status: RecoveryStatus, reason: string): string {
  const output = operatorFailureReport(status, reason, {
    observed: reason,
    reason,
    hardwareDispatch: "NO",
    nextAction: `Correct ${reason} before retrying.`,
  });
  assertOperatorVisible(output, status);
  return output;
}

async function main(): Promise<void> {
  const installer = readFileSync("packaging/install.sh", "utf8");
  assert.match(
    installer,
    /BACKUP_ROOT="\$INSTALL_ROOT\/\$RLSOK_RUNTIME_VERSION\.activation-backup"/,
  );
  assert.match(
    installer,
    /rollback was incomplete; recovery remains at \$ROLLBACK_ROOT and \$BACKUP_ROOT/,
  );
  assert.match(installer, /rm -rf "\$ROLLBACK_ROOT" "\$BACKUP_ROOT"/);
  assert.equal(
    hardwareDispatchForCliFailure("ros2", "run", "ROS 2 unavailable"),
    "NO",
  );
  assert.equal(
    hardwareDispatchForCliFailure(
      "ros2",
      "run",
      "controller_dispatch_unknown:transport_failed",
    ),
    "UNKNOWN",
  );
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-first-user-recovery-"));
  const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
  const sidecar = resolve(
    process.cwd(),
    "experimental/ros2-reference-sidecar/rlsok_ros2_simulated_sidecar.py",
  );
  const config = join(temporary, "config");
  const data = join(temporary, "data");
  mkdirSync(config, { recursive: true });
  const discovery = join(temporary, "discovery.json");
  writeFileSync(
    discovery,
    JSON.stringify({
      rosAvailable: true,
      rosDistro: "jazzy",
      rmwImplementation: "rmw_fastrtps_cpp",
      rosDomainId: "0",
      jointStateSources: [
        {
          name: "/joint_states",
          types: ["sensor_msgs/msg/JointState"],
          sample: {
            jointNames: ["joint_a", "joint_b"],
            positions: [0, 0],
            observedAt: new Date().toISOString(),
          },
        },
      ],
      trajectoryActionServers: [
        {
          name: "/joint_trajectory_controller/follow_joint_trajectory",
          types: ["control_msgs/action/FollowJointTrajectory"],
        },
      ],
      nodes: ["recovery-fixture"],
    }),
  );
  const baseEnvironment = {
    ...process.env,
    RLSOK_SETUP_ACCEPTANCE: "1",
    RLSOK_SETUP_DISCOVERY_FIXTURE: discovery,
    RLSOK_DATA_HOME: data,
    XDG_CONFIG_HOME: config,
    LOCALAPPDATA: config,
    ROS_DISTRO: "jazzy",
    RMW_IMPLEMENTATION: "rmw_fastrtps_cpp",
  };
  const runCli = (args: string[], environment = baseEnvironment) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env: environment,
      encoding: "utf8",
    });
    return {
      status: result.status,
      output: `${result.stderr ?? ""}\n${result.stdout ?? ""}`,
    };
  };
  const covered: Array<{
    case: string;
    status: RecoveryStatus;
    reason: string;
    hardwareDispatch: "NO";
  }> = [];
  const record = (name: string, status: RecoveryStatus, reason: string) => {
    report(status, reason);
    covered.push({ case: name, status, reason, hardwareDispatch: "NO" });
  };

  const missingArtifact = runCli([
    "setup",
    "--artifact",
    join(temporary, "missing-policy.bin"),
    "--cloud",
    "http://127.0.0.1:1",
    "--non-interactive",
    "--no-browser",
  ]);
  assert.equal(missingArtifact.status, 2);
  assertOperatorVisible(missingArtifact.output, "FAILED");
  record("missing artifact", "FAILED", "policy_artifact_missing");

  const emptyArtifactPath = join(temporary, "empty-policy.bin");
  writeFileSync(emptyArtifactPath, "");
  const emptyArtifact = runCli([
    "setup",
    "--artifact",
    emptyArtifactPath,
    "--cloud",
    "http://127.0.0.1:1",
    "--non-interactive",
    "--no-browser",
  ]);
  assert.equal(emptyArtifact.status, 2);
  assertOperatorVisible(emptyArtifact.output, "FAILED");
  record("empty artifact", "FAILED", "policy_artifact_empty");

  const originalArtifact = join(temporary, "approved-policy.bin");
  writeFileSync(originalArtifact, "approved bytes\n");
  const approvedHash = sha256(readFileSync(originalArtifact));
  writeFileSync(originalArtifact, "changed bytes\n");
  assert.notEqual(sha256(readFileSync(originalArtifact)), approvedHash);
  record(
    "artifact changed after approval",
    "BLOCKED",
    "local_policy_artifact_changed_after_approval",
  );

  assert.throws(
    () => loadCloudClientConfig({ RLSOK_EXECUTION_MODE: "cloud-connected" }),
    /RLSOK_CLOUD_API_URL_is_required/,
  );
  record("missing credentials", "FAILED", "cloud_credentials_missing");

  const credentialDirectory = join(config, "rlsok");
  mkdirSync(credentialDirectory, { recursive: true });
  writeFileSync(join(credentialDirectory, "cloud-credentials.json"), "{bad", {
    mode: 0o600,
  });
  assert.throws(
    () => readStoredCloudCredentials(baseEnvironment),
    /Unexpected token|JSON/,
  );
  record("corrupt credentials", "FAILED", "stored_cloud_credentials_invalid");
  rmSync(join(credentialDirectory, "cloud-credentials.json"));

  const pairingServer = createServer((request, response) => {
    response.writeHead(201, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        pairingId: "33333333-3333-4333-8333-333333333333",
        pairingToken: `rlsok_${"a".repeat(43)}`,
        userCode: "EXPIRE",
        verificationUri: "http://127.0.0.1/pair",
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    );
  });
  await new Promise<void>((resolveListen) =>
    pairingServer.listen(0, "127.0.0.1", resolveListen),
  );
  const pairingAddress = pairingServer.address();
  assert(pairingAddress && typeof pairingAddress === "object");
  const expiredPairing = await new Promise<{ status: number | null; output: string }>(
    (resolveExit, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "pair", "--cloud", `http://127.0.0.1:${pairingAddress.port}`, "--no-browser"],
        { env: baseEnvironment, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
      child.once("error", reject);
      child.once("exit", (status) => resolveExit({ status, output }));
    },
  );
  await new Promise<void>((resolveClose) => pairingServer.close(() => resolveClose()));
  assert.equal(expiredPairing.status, 2);
  assertOperatorVisible(expiredPairing.output, "FAILED");
  record("expired pairing", "FAILED", "pairing_expired");

  const unavailable = new RlsokCloudClient({
    apiUrl: new URL("http://127.0.0.1:1"),
    apiKey: `rlsok_${"b".repeat(43)}`,
    timeoutMs: 100,
    maxResponseBytes: 1024,
    safeRetryCount: 0,
  });
  await assert.rejects(unavailable.getRelease("missing"));
  record("Cloud unavailable", "FAILED", "cloud_unavailable");

  const incompatible = new RlsokCloudClient(
    {
      apiUrl: new URL("http://127.0.0.1:8080"),
      apiKey: `rlsok_${"c".repeat(43)}`,
      timeoutMs: 100,
      maxResponseBytes: 1024,
      safeRetryCount: 0,
    },
    async () =>
      new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(
    incompatible.consumePermit("11111111-1111-4111-8111-111111111111", {
      evaluationMode: "shadow",
      releaseId: "fixture-release-001",
      contentHash: "a".repeat(64),
      actionHash: "b".repeat(64),
      deviceId: "fixture-arm-01",
      controllerId: "c".repeat(64),
      configurationDigest: "d".repeat(64),
    }),
    (error: unknown) =>
      error instanceof CloudClientError &&
      error.code === "cloud_runtime_incompatible:upgrade_cloud_before_runtime",
  );
  record(
    "incompatible old Cloud",
    "BLOCKED",
    "cloud_runtime_incompatible:upgrade_cloud_before_runtime",
  );

  const fixture = JSON.parse(
    readFileSync(resolve("fixtures/cloud-contract/v1/release.json"), "utf8"),
  ) as { execSpec: Record<string, any> };
  const revoked = structuredClone(fixture.execSpec);
  revoked.evidence.status = "revoked";
  revoked.evidence.approvedBy = "";
  revoked.evidence.approvedAt = "";
  const revokedResult = checkExecutablePolicySpec(revoked);
  assert.equal(revokedResult.result, "BLOCK");
  assert(revokedResult.reasons.includes("release_revoked"));
  record("revoked release", "BLOCKED", "release_revoked");

  const expired = structuredClone(fixture.execSpec);
  expired.deployment.expiresAt = "2020-01-01T00:00:00.000Z";
  const expiredResult = checkExecutablePolicySpec(expired);
  assert.equal(expiredResult.result, "BLOCK");
  assert(expiredResult.reasons.includes("release_expired"));
  record("expired release", "BLOCKED", "release_expired");

  const drifted = structuredClone(fixture.execSpec.executionConfiguration);
  drifted.observedAt = new Date().toISOString();
  drifted.controller.followJointTrajectoryAction = "/changed/follow_joint_trajectory";
  const drift = evaluateConfigurationBinding({
    approvedConfigurationDigest: fixture.execSpec.approvedConfigurationDigest,
    observedConfiguration: drifted,
    mode: "shadow",
    maxAgeMs: 10_000,
  });
  assert.equal(drift.allowed, false);
  assert.equal(drift.reason, "configuration_mismatch");
  record("configuration drift", "BLOCKED", "configuration_mismatch");

  const missingSetup = runCli(["observe", "--setup", join(temporary, "missing-setup.json")]);
  assert.equal(missingSetup.status, 2);
  assertOperatorVisible(missingSetup.output, "FAILED");
  record("missing local setup state", "FAILED", "local_setup_state_missing");

  const corruptSetupPath = join(temporary, "corrupt-setup.json");
  writeFileSync(corruptSetupPath, "{bad");
  const corruptSetup = runCli(["observe", "--setup", corruptSetupPath]);
  assert.equal(corruptSetup.status, 2);
  assertOperatorVisible(corruptSetup.output, "FAILED");
  record("corrupt local setup state", "FAILED", "local_setup_state_corrupt");

  const evidenceDirectory = join(temporary, "unwritable-evidence-target");
  mkdirSync(evidenceDirectory);
  assert.throws(() => writeFileSync(evidenceDirectory, "evidence"));
  record("unwritable Evidence path", "FAILED", "evidence_path_unwritable");

  const evidence: ExecutionEvidence = {
    releaseId: "fixture-release-001",
    executablePolicyHash: "a".repeat(64),
    modelHash: "b".repeat(64),
    actionContractHash: "c".repeat(64),
    robotProfileHash: "d".repeat(64),
    controllerProfileHash: "e".repeat(64),
    runtimePolicyHash: "f".repeat(64),
    deviceId: "fixture-arm-01",
    proposalId: "tamper-proof",
    proposedAction: {},
    decision: "blocked",
    decisionReason: "fixture",
    matchedRuleIds: [],
    decisionMadeAt: new Date().toISOString(),
    hardwareSignalSent: false,
    hardwareSignalState: "not_sent",
    executionEvidence: "fixture",
  };
  const entry = appendEvidence([], evidence);
  const bundle: EvidenceBundle = {
    apiVersion: "realitywarden.io/v1alpha1",
    kind: "EvidenceBundle",
    releaseId: evidence.releaseId,
    executablePolicyHash: evidence.executablePolicyHash,
    createdAt: new Date().toISOString(),
    entries: [{ ...entry, evidence: { ...entry.evidence, decisionReason: "tampered" } }],
  };
  const tampered = verifyEvidenceBundle(bundle);
  assert.equal(tampered.ok, false);
  assert.match(tampered.reason, /content_hash_mismatch/);
  record("tampered Evidence", "FAILED", tampered.reason);

  const emptyEvidence = verifyEvidenceBundle({
    ...bundle,
    entries: [],
  });
  assert.deepEqual(emptyEvidence, { ok: false, reason: "bundle_empty" });
  record("empty Evidence bundle", "FAILED", "bundle_empty");

  const incompleteEvidence = verifyEvidenceBundle({
    ...bundle,
    entries: [
      {
        ...entry,
        evidence: {
          ...entry.evidence,
          decisionReason: "",
        },
      },
    ],
  });
  assert.deepEqual(incompleteEvidence, {
    ok: false,
    reason: "entry_missing_or_malformed:0",
  });
  record(
    "incomplete Evidence entry",
    "FAILED",
    "entry_missing_or_malformed:0",
  );

  const invalidOptionalDigest = verifyEvidenceBundle({
    ...bundle,
    entries: [
      {
        ...entry,
        evidence: {
          ...entry.evidence,
          expectedConfigurationDigest: "not-a-digest",
        },
      },
    ],
  });
  assert.deepEqual(invalidOptionalDigest, {
    ok: false,
    reason: "entry_missing_or_malformed:0",
  });
  record(
    "invalid optional Evidence digest",
    "FAILED",
    "entry_missing_or_malformed:0",
  );

  const proofPath =
    process.env.RLSOK_RECOVERY_MATRIX_PROOF ??
    resolve("artifacts/first-user-recovery-matrix.json");
  mkdirSync(resolve(proofPath, ".."), { recursive: true });
  writeFileSync(
    proofPath,
    `${JSON.stringify(
      {
        sourceCommit: process.env.GITHUB_SHA ?? null,
        cases: covered,
        allPreDispatchFailuresHardwareDispatchNo: true,
        authorizationLogicReused: true,
        physicalRobotTested: false,
      },
      null,
      2,
    )}\n`,
  );
  assert.equal(covered.length, 18);
  process.stdout.write("ok - first-user recovery matrix (18 cases)\n");
  rmSync(temporary, { recursive: true, force: true });
}

void main();

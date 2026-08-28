import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runExternalRos2ValidationCommand } from "../../apps/cli/validate-external-ros2";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import { executablePolicyHash, type ExecutablePolicySpec } from "../../packages/core/exec-spec";

const H = (character: string): string => character.repeat(64);
const releaseId = "external-shadow-001";
const deviceId = "arm-01";
const controllerId = H("6");
const approverId = "independent-admin-02";
const actionPayload = {
  representation: "trajectory" as const,
  jointNames: ["joint_a", "joint_b"],
  points: [{ positions: [0.1, -0.1], timeFromStartMs: 500 }],
  units: { position: "radian" as const, velocity: "radian_per_second" as const },
};
const actionHash = sha256(canonicalJson(actionPayload));

const caseDefinitions = [
  { id: "clean_install", outcome: "PASS", reason: "clean_install_verified", observer: false, evidence: false, approval: false, subject: false },
  { id: "setup_zero_to_shadow", outcome: "PASS", reason: "shadow_permit_evaluated_no_controller_call", observer: true, evidence: true, approval: true, subject: true },
  { id: "malformed_input", outcome: "BLOCK", reason: "proposal_invalid", observer: true, evidence: false, approval: false, subject: true },
  { id: "stale_state", outcome: "BLOCK", reason: "joint_state_stale", observer: true, evidence: false, approval: false, subject: true },
  { id: "duplicate_replay", outcome: "BLOCK", reason: "proposal_id_duplicate", observer: true, evidence: true, approval: false, subject: true },
  { id: "restart_shadow", outcome: "PASS", reason: "shadow_permit_evaluated_no_controller_call", observer: true, evidence: true, approval: false, subject: true },
  { id: "configuration_drift", outcome: "BLOCK", reason: "configuration_mismatch", observer: true, evidence: true, approval: false, subject: true },
  { id: "revoked_release", outcome: "BLOCK", reason: "cloud_release_not_eligible:revoked", observer: true, evidence: true, approval: false, subject: true },
  { id: "evidence_tamper", outcome: "BLOCK", reason: "evidence_verification_failed", observer: false, evidence: false, approval: false, subject: true },
] as const;

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function maliciouslyRebaselineLocalChecksums(output: string): void {
  const manifestPath = join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
  };
  for (const entry of manifest.files) entry.sha256 = fileSha256(join(output, ...entry.path.split("/")));
  writeJson(manifestPath, manifest);
  writeFileSync(
    join(output, "SHA256SUMS"),
    `${[...manifest.files, { path: "manifest.json", sha256: fileSha256(manifestPath) }]
      .map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
    "utf8",
  );
}

interface SessionFacts {
  output: string;
  sessionId: string;
  createdAt: string;
  environment: {
    rosDistro: string | null;
    rmwImplementation: string | null;
    rosDomainId: string | null;
  };
}

async function initialize(root: string): Promise<SessionFacts> {
  const output = join(root, "bundle");
  await runExternalRos2ValidationCommand([
    "init", "--output", output, "--operator", "operator@example.test",
    "--target", "generic ROS 2 Jazzy test graph",
  ]);
  const session = JSON.parse(readFileSync(join(output, "session.json"), "utf8")) as Omit<SessionFacts, "output">;
  return { output, ...session };
}

function policy(approvedAt: string, artifactSha256: string): ExecutablePolicySpec {
  return {
    apiVersion: "realitywarden.io/v1alpha1",
    kind: "ExecutablePolicy",
    metadata: { name: "external-shadow", releaseId, createdAt: approvedAt },
    model: {
      artifact: "policy.bin", sha256: artifactSha256, framework: "ros2",
      policyType: "external-shadow-fixture", codeRevision: "external-validation-v1",
    },
    actionContract: {
      representation: "trajectory", dimension: 2, jointOrder: ["joint_a", "joint_b"],
      units: { position: "radian", velocity: "radian_per_second" },
      normalizerSha256: H("1"), preprocessorSha256: H("2"), postprocessorSha256: H("3"),
    },
    robot: {
      profileId: "generic-two-joint", profileSha256: H("4"), urdfSha256: H("5"),
      controllerType: "FollowJointTrajectory", controllerConfigSha256: H("6"),
    },
    runtimePolicy: { policySha256: H("7"), maxStateAgeMs: 1000, failClosed: true },
    approvedConfigurationDigest: H("b"),
    evidence: {
      scenarioPackId: "external-shadow", testReportSha256: H("8"), status: "approved",
      approvedBy: approverId, approvedAt,
    },
    deployment: { allowedDeviceIds: [deviceId], mode: "shadow", expiresAt: "2099-01-01T00:00:00.000Z" },
  };
}

function proposal(proposalId: string, createdAt = new Date().toISOString()) {
  return {
    proposalId, releaseId, deviceId, proposerIdentity: "external-proposer-01",
    actionRepresentation: "trajectory", actionPayload, createdAt,
  };
}

function invocation(
  path: string,
  input: {
    session: SessionFacts;
    caseId: string;
    command: string;
    subject: string | null;
    policyArtifact: string | null;
    setupState?: string | null;
  },
): string {
  return writeJson(path, {
    schema: "rlsok.io/external-command-invocation/v1",
    sessionId: input.session.sessionId,
    caseId: input.caseId,
    commandSha256: fileSha256(input.command),
    capturedAt: new Date().toISOString(),
    environment: {
      runtimeBinary: process.execPath,
      runtimeBinarySha256: fileSha256(process.execPath),
      runtimeVersion: "rlsok test runtime",
      rosDistro: input.session.environment.rosDistro,
      rmwImplementation: input.session.environment.rmwImplementation,
      rosDomainId: input.session.environment.rosDomainId,
      cloudBaseUrl: input.caseId === "clean_install" ? null : "https://api.rlsok.test",
      controllerAction: "/joint_trajectory_controller/follow_joint_trajectory",
      jointStateTopic: "/joint_states",
      joints: ["joint_a", "joint_b"],
      setupPath: input.setupState ?? null,
      setupStateSha256: input.setupState ? fileSha256(input.setupState) : null,
      proposalPath: input.caseId === "setup_zero_to_shadow" ? null : input.subject,
      proposalSha256: input.caseId === "setup_zero_to_shadow" || !input.subject
        ? null : fileSha256(input.subject),
      policyArtifactPath: input.policyArtifact,
      policyArtifactSha256: input.policyArtifact ? fileSha256(input.policyArtifact) : null,
      pauseState: input.caseId === "stale_state",
      configurationDrift: input.caseId === "configuration_drift",
    },
  });
}

async function observer(
  path: string,
  input: { session: SessionFacts; caseId: string; command: string; invocation: string },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const capturedAt = (JSON.parse(readFileSync(input.invocation, "utf8")) as { capturedAt: string }).capturedAt;
  const base = Math.max(Date.now(), Date.parse(capturedAt)) + 1;
  const armed = new Date(base).toISOString();
  const serverReady = new Date(base + 1).toISOString();
  const started = new Date(base + 2).toISOString();
  const stateMatched = new Date(base + 2).toISOString();
  const lastState = new Date(base + 3).toISOString();
  const paused = new Date(base + 4).toISOString();
  const finishedOffset = input.caseId === "stale_state" ? 1_205 : 6;
  const finished = new Date(base + finishedOffset).toISOString();
  const settled = new Date(base + finishedOffset + 110).toISOString();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, base + finishedOffset + 115 - Date.now())));
  return writeJson(path, {
    schema: "rlsok.io/zero-dispatch-observer/v1",
    sessionId: input.session.sessionId,
    caseId: input.caseId,
    commandSha256: fileSha256(input.command),
    invocationSha256: fileSha256(input.invocation),
    observerInstanceId: randomUUID(),
    nonce: randomUUID(),
    observerId: "independent-controller-goal-counter",
    implementation: "separate ROS 2 action server instrumentation",
    independentFromRlsok: true,
    commandPath: "/joint_trajectory_controller/follow_joint_trajectory",
    armedBeforeCommand: true,
    commandPathMatched: true,
    qosCompatible: true,
    armedAt: armed,
    serverReadyAt: serverReady,
    commandStartedAt: started,
    rlsokClientMatchedAt: started,
    jointStateSubscriberMatchedAt: stateMatched,
    jointStatePublicationsBeforePause: input.caseId === "stale_state" ? 10 : 1,
    lastJointStatePublishedAt: lastState,
    statePausedAt: input.caseId === "stale_state" ? paused : null,
    commandFinishedAt: finished,
    settleFinishedAt: settled,
    commandServerCountAtArm: 1,
    maximumCommandServerCount: 1,
    baselineDispatchCount: 4,
    finalDispatchCount: 4,
    rlsokDispatchesObserved: 0,
    goalRequests: [],
    acceptedGoalCancelCallbacks: 0,
    observerCompleted: true,
    terminationReason: "settle_complete",
    statePausedDuringWindow: input.caseId === "stale_state",
    configurationDriftDuringWindow: input.caseId === "configuration_drift",
    ...overrides,
  });
}

async function execution(
  path: string,
  input: {
    session: SessionFacts;
    caseId: string;
    invocation: string;
    command: string;
    log: string;
    observer: string | null;
    exitCode: number;
  },
): Promise<string> {
  let started = new Date(Date.now() + 1).toISOString();
  let finished = new Date(Date.now() + 3).toISOString();
  if (input.observer) {
    const proof = JSON.parse(readFileSync(input.observer, "utf8")) as {
      commandStartedAt: string;
      commandFinishedAt: string;
    };
    started = proof.commandStartedAt;
    finished = proof.commandFinishedAt;
  } else {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return writeJson(path, {
    schema: "rlsok.io/external-command-execution/v1",
    sessionId: input.session.sessionId,
    caseId: input.caseId,
    invocationSha256: fileSha256(input.invocation),
    commandSha256: fileSha256(input.command),
    commandLogSha256: fileSha256(input.log),
    observerSha256: input.observer ? fileSha256(input.observer) : null,
    commandExitCode: input.exitCode,
    commandStartedAt: started,
    commandFinishedAt: finished,
  });
}

let evidenceSequence = 0;
let previousEvidenceHash: string | null = null;
let exportedEvidenceRecords: Array<Record<string, unknown>> = [];

function evidencePair(
  root: string,
  contentHash: string,
  input: { caseId: string; decision: "allowed" | "blocked"; reason: string; proposalId: string },
): { local: string; cloud: string } {
  const allowed = input.decision === "allowed";
  const permitId = allowed ? randomUUID() : null;
  const localPermitConsumed = allowed;
  const cloudPermitConsumed = allowed;
  const cloudPermitConsumptionState = allowed ? "consumed" : "not_consumed";
  const cloudEvidenceId = randomUUID();
  const expectedConfigurationDigest = H("b");
  const observedConfigurationDigest = input.caseId === "configuration_drift"
    ? H("c") : input.caseId === "duplicate_replay" ? null : expectedConfigurationDigest;
  const payload = {
    contractVersion: "rlsok-cloud/v1", evaluationMode: allowed ? "shadow" : "denial",
    contentHash, actionHash, deviceId, controllerId, expectedConfigurationDigest,
    observedConfigurationDigest, localPermitConsumed, cloudPermitConsumptionState,
    controllerGoalsAttempted: 0,
    reason: input.reason,
  };
  const createdAt = new Date(Date.now() + evidenceSequence).toISOString();
  const body = {
    sequence: evidenceSequence++, previousHash: previousEvidenceHash, releaseId, permitId,
    decision: input.decision, hardwareSignalSent: false, payload, createdAt,
  };
  const evidenceHash = sha256(canonicalJson(body));
  previousEvidenceHash = evidenceHash;
  const cloud = writeJson(join(root, `${input.caseId}.cloud-evidence.json`), {
    id: cloudEvidenceId, ...body, evidenceHash,
  });
  exportedEvidenceRecords.push({
    id: cloudEvidenceId,
    ...body,
    evidenceHash,
    organizationFingerprint: H("a"),
    includedForReleaseFilter: true,
  });
  const local = writeJson(join(root, `${input.caseId}.evidence.json`), {
    executionMode: "cloud-connected", mode: "shadow", releaseId,
    proposalId: input.proposalId, decision: input.decision, reason: input.reason,
    cloudPermitId: permitId, cloudPermitConsumed, cloudPermitConsumptionState,
    localPermitConsumed,
    controllerGoalsAttempted: 0, hardwareSignalSent: false, cloudEvidenceId,
    evidenceVerified: true,
    responsibilityBoundary: [
      "RLSOK determines whether a specific release is eligible for the configured controller path.",
      "RLSOK does not determine whether the resulting physical motion is safe.",
    ],
  });
  return { local, cloud };
}

test("external ROS 2 toolkit binds executions, recovers torn finalize, and re-verifies", async () => {
  const root = mkdtempSync(join(tmpdir(), "rlsok-external-validation-"));
  evidenceSequence = 0;
  previousEvidenceHash = null;
  exportedEvidenceRecords = [];
  try {
    const session = await initialize(root);
    const approvedAt = new Date(Date.parse(session.createdAt) + 1).toISOString();
    const policyArtifact = join(root, "policy.bin");
    writeFileSync(policyArtifact, "external policy fixture\n", "utf8");
    const execSpec = policy(approvedAt, fileSha256(policyArtifact));
    const contentHash = executablePolicyHash(execSpec);
    const releaseReceipt = writeJson(join(root, "cloud-release.json"), {
      releaseId, contentHash, state: "approved", execSpec,
    });
    const approval = writeJson(join(root, "approval.json"), {
      schema: "rlsok.io/external-approval-proof/v1",
      sessionId: session.sessionId, releaseId, executablePolicyHash: contentHash,
      runtimeCredentialId: "runtime-credential-01", approverPrincipalId: approverId,
      independentlyApproved: true, approvedAt,
      cloudReleaseReceiptSha256: fileSha256(releaseReceipt),
    });
    const setupState = writeJson(join(root, "setup.json"), {
      schema: "rlsok.io/setup-state/v1", releaseId, deviceId,
    });
    let setupSubject = "";
    let originalEvidenceChain: string | null = null;

    for (const definition of caseDefinitions) {
      const command = join(root, `${definition.id}.command.txt`);
      const log = join(root, `${definition.id}.log`);
      writeFileSync(command, `rlsok external-test ${definition.id}\n`, "utf8");
      writeFileSync(log, `${definition.outcome}: ${definition.reason}\n`, "utf8");
      let proposalId = `proposal-${definition.id}`;
      if (definition.id === "setup_zero_to_shadow" || definition.id === "duplicate_replay") proposalId = "proposal-setup";
      let subject: string | null = null;
      if (definition.subject) {
        if (definition.id === "duplicate_replay") subject = setupSubject;
        else if (definition.id === "malformed_input") {
          subject = join(root, `${definition.id}.subject.json`);
          writeFileSync(subject, '{"proposalId":', "utf8");
        } else if (definition.id === "evidence_tamper") {
          const original = {
            apiVersion: "rlsok-cloud/v1",
            organizationFingerprint: H("a"),
            releaseFilter: releaseId,
            firstSequence: 0,
            lastSequence: exportedEvidenceRecords.length - 1,
            trustedCheckpoint: null,
            records: structuredClone(exportedEvidenceRecords),
          };
          originalEvidenceChain = writeJson(join(root, "original-evidence-chain.json"), original);
          const tampered = structuredClone(original);
          (tampered.records[0] as { evidenceHash: string }).evidenceHash = H("0");
          subject = writeJson(join(root, `${definition.id}.subject.json`), tampered);
        } else subject = writeJson(join(root, `${definition.id}.subject.json`), proposal(proposalId));
        if (definition.id === "setup_zero_to_shadow") setupSubject = subject;
      }
      const invocationPath = invocation(join(root, `${definition.id}.invocation.json`), {
        session, caseId: definition.id, command, subject,
        policyArtifact: definition.id === "setup_zero_to_shadow" ? policyArtifact : null,
        setupState: ["clean_install", "setup_zero_to_shadow"].includes(definition.id)
          ? null : setupState,
      });
      const observerPath = definition.observer
        ? await observer(join(root, `${definition.id}.observer.json`), {
            session, caseId: definition.id, command, invocation: invocationPath,
          }) : null;
      const exitCode = definition.outcome === "PASS" ? 0 : 2;
      const executionPath = await execution(join(root, `${definition.id}.execution.json`), {
        session, caseId: definition.id, invocation: invocationPath, command, log,
        observer: observerPath, exitCode,
      });
      let runtimeLogPath: string | null = null;
      let negativeResultPath: string | null = null;
      if (["malformed_input", "stale_state"].includes(definition.id)) {
        runtimeLogPath = join(root, `${definition.id}.runtime.log`);
        writeFileSync(runtimeLogPath, `BLOCKED\nReason: ${definition.reason}\n`, "utf8");
        const executionValue = JSON.parse(readFileSync(executionPath, "utf8")) as {
          commandStartedAt: string;
          commandFinishedAt: string;
        };
        const observedAt = new Date(
          (Date.parse(executionValue.commandStartedAt) + Date.parse(executionValue.commandFinishedAt)) / 2,
        ).toISOString();
        negativeResultPath = writeJson(join(root, `${definition.id}.negative-result.json`), {
          schema: "rlsok.io/external-negative-runtime-result/v1",
          sessionId: session.sessionId,
          caseId: definition.id,
          reason: definition.reason,
          subjectSha256: fileSha256(subject!),
          runtimeLogSha256: fileSha256(runtimeLogPath),
          observedAt,
        });
      }
      const args = [
        "record", "--output", session.output, "--case", definition.id,
        "--outcome", definition.outcome, "--reason", definition.reason,
        "--command", command, "--log", log,
        "--invocation", invocationPath, "--execution", executionPath,
      ];
      if (subject) args.push("--subject", subject);
      if (originalEvidenceChain) args.push("--original-evidence-chain", originalEvidenceChain);
      if (observerPath) args.push("--observer", observerPath);
      if (runtimeLogPath && negativeResultPath) {
        args.push("--runtime-log", runtimeLogPath, "--negative-result", negativeResultPath);
      }
      if (definition.evidence) {
        const pair = evidencePair(root, contentHash, {
          caseId: definition.id,
          decision: definition.outcome === "PASS" ? "allowed" : "blocked",
          reason: definition.reason, proposalId,
        });
        args.push("--evidence", pair.local, "--cloud-evidence", pair.cloud);
      }
      if (definition.approval) args.push("--approval", approval, "--release-receipt", releaseReceipt);
      await runExternalRos2ValidationCommand(args);
    }

    const pendingManifest = readFileSync(join(session.output, "manifest.json"));
    const pendingChecksums = readFileSync(join(session.output, "SHA256SUMS"));
    await runExternalRos2ValidationCommand(["finalize", "--output", session.output]);
    writeFileSync(join(session.output, "manifest.json"), pendingManifest);
    writeFileSync(join(session.output, "SHA256SUMS"), pendingChecksums);
    const interruptedTemporary = join(session.output, `.manifest.json.999.${randomUUID()}.rlsok-tmp`);
    writeFileSync(interruptedTemporary, "partial", "utf8");
    const lockPath = `${session.output}.rlsok-validation.lock`;
    writeJson(lockPath, { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() });
    await assert.rejects(
      runExternalRos2ValidationCommand(["recover", "--output", session.output]),
      /validation_session_lock_owner_still_running/,
    );
    rmSync(lockPath);
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid ?? 2_147_483_647;
    writeJson(lockPath, { pid: deadPid, nonce: randomUUID(), createdAt: new Date().toISOString() });
    await runExternalRos2ValidationCommand(["recover", "--output", session.output]);
    assert.equal(existsSync(interruptedTemporary), false);
    assert.equal(existsSync(lockPath), false);
    await runExternalRos2ValidationCommand(["verify", "--output", session.output]);

    const result = JSON.parse(readFileSync(join(session.output, "result.json"), "utf8")) as {
      status: string;
      reviewStatus: string;
      cases: unknown[];
      assurance: { cloudEvidenceAuthenticity: string };
    };
    assert.equal(result.status, "COLLECTED_SELF_ATTESTED");
    assert.equal(result.reviewStatus, "EXTERNAL_REVIEW_REQUIRED");
    assert.equal(result.cases.length, caseDefinitions.length);
    assert.equal(result.assurance.cloudEvidenceAuthenticity, "SELF_ATTESTED");

    const forged = JSON.parse(readFileSync(join(session.output, "result.json"), "utf8")) as { operator: string };
    forged.operator = "forged-reviewer@example.test";
    writeJson(join(session.output, "result.json"), forged);
    maliciouslyRebaselineLocalChecksums(session.output);
    await assert.rejects(
      runExternalRos2ValidationCommand(["verify", "--output", session.output]),
      /validation_result_projection_mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid observer is rejected before the validation session is mutated", async () => {
  const root = mkdtempSync(join(tmpdir(), "rlsok-external-observer-"));
  try {
    const session = await initialize(root);
    const command = join(root, "command.txt");
    const log = join(root, "command.log");
    const subject = join(root, "subject.json");
    writeFileSync(command, "rlsok ros2 shadow ...\n", "utf8");
    writeFileSync(log, "BLOCK\n", "utf8");
    writeFileSync(subject, '{"proposalId":', "utf8");
    const invocationPath = invocation(join(root, "invocation.json"), {
      session, caseId: "malformed_input", command, subject, policyArtifact: null,
    });
    const invalid = await observer(join(root, "invalid-observer.json"), {
      session, caseId: "malformed_input", command, invocation: invocationPath,
    }, { finalDispatchCount: 5, rlsokDispatchesObserved: 1 });
    const executionPath = await execution(join(root, "execution.json"), {
      session, caseId: "malformed_input", invocation: invocationPath, command, log,
      observer: invalid, exitCode: 2,
    });
    const manifestBefore = readFileSync(join(session.output, "manifest.json"), "utf8");
    await assert.rejects(
      runExternalRos2ValidationCommand([
        "record", "--output", session.output, "--case", "malformed_input",
        "--outcome", "BLOCK", "--reason", "proposal_invalid",
        "--command", command, "--log", log, "--subject", subject,
        "--invocation", invocationPath, "--execution", executionPath, "--observer", invalid,
      ]),
      /observer_did_not_prove_independent_zero_dispatch/,
    );
    assert.equal(readFileSync(join(session.output, "manifest.json"), "utf8"), manifestBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("external collector rejects inconsistent Cloud Permit consumption claims", async () => {
  const root = mkdtempSync(join(tmpdir(), "rlsok-external-consumption-"));
  evidenceSequence = 0;
  previousEvidenceHash = null;
  exportedEvidenceRecords = [];
  try {
    const session = await initialize(root);
    const command = join(root, "restart.command.txt");
    const log = join(root, "restart.log");
    const subject = writeJson(
      join(root, "restart.subject.json"),
      proposal("proposal-consumption-binding"),
    );
    const setupState = writeJson(join(root, "setup.json"), {
      schema: "rlsok.io/setup-state/v1", releaseId, deviceId,
    });
    writeFileSync(command, "rlsok external-test restart_shadow\n", "utf8");
    writeFileSync(log, "PASS: shadow_permit_evaluated_no_controller_call\n", "utf8");
    const invocationPath = invocation(join(root, "restart.invocation.json"), {
      session, caseId: "restart_shadow", command, subject,
      policyArtifact: null, setupState,
    });
    const observerPath = await observer(join(root, "restart.observer.json"), {
      session, caseId: "restart_shadow", command, invocation: invocationPath,
    });
    const executionPath = await execution(join(root, "restart.execution.json"), {
      session, caseId: "restart_shadow", invocation: invocationPath, command, log,
      observer: observerPath, exitCode: 0,
    });
    const pair = evidencePair(root, H("d"), {
      caseId: "restart_shadow", decision: "allowed",
      reason: "shadow_permit_evaluated_no_controller_call",
      proposalId: "proposal-consumption-binding",
    });
    const baselineLocal = JSON.parse(readFileSync(pair.local, "utf8")) as Record<string, unknown>;
    const baselineCloud = JSON.parse(readFileSync(pair.cloud, "utf8")) as Record<string, unknown>;
    const args = [
      "record", "--output", session.output, "--case", "restart_shadow",
      "--outcome", "PASS", "--reason", "shadow_permit_evaluated_no_controller_call",
      "--command", command, "--log", log, "--subject", subject,
      "--invocation", invocationPath, "--execution", executionPath,
      "--observer", observerPath, "--evidence", pair.local,
      "--cloud-evidence", pair.cloud,
    ];
    const manifestBefore = readFileSync(join(session.output, "manifest.json"), "utf8");

    const allowedUnknownLocal = structuredClone(baselineLocal);
    allowedUnknownLocal.cloudPermitConsumptionState = "unknown";
    const allowedUnknownCloud = structuredClone(baselineCloud);
    (allowedUnknownCloud.payload as Record<string, unknown>).cloudPermitConsumptionState = "unknown";
    writeJson(pair.local, allowedUnknownLocal);
    writeJson(pair.cloud, allowedUnknownCloud);
    await assert.rejects(
      runExternalRos2ValidationCommand(args),
      /allowed_shadow_did_not_consume_both_bound_permits/,
    );

    const mismatchedReceipt = structuredClone(baselineCloud);
    (mismatchedReceipt.payload as Record<string, unknown>).cloudPermitConsumptionState = "unknown";
    writeJson(pair.local, baselineLocal);
    writeJson(pair.cloud, mismatchedReceipt);
    await assert.rejects(
      runExternalRos2ValidationCommand(args),
      /cloud_evidence_receipt_did_not_bind_local_result/,
    );

    const mismatchedLegacyBoolean = structuredClone(baselineLocal);
    mismatchedLegacyBoolean.cloudPermitConsumed = false;
    writeJson(pair.local, mismatchedLegacyBoolean);
    writeJson(pair.cloud, baselineCloud);
    await assert.rejects(
      runExternalRos2ValidationCommand(args),
      /allowed_shadow_did_not_consume_both_bound_permits/,
    );
    assert.equal(readFileSync(join(session.output, "manifest.json"), "utf8"), manifestBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

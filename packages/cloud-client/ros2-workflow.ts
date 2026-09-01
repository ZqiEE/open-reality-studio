import {
  executablePolicyHash,
  type ExecutablePolicySpec,
} from "../core/exec-spec";
import { canonicalJson, sha256 } from "../core/evidence";
import {
  evaluateConfigurationBinding,
  type ExecutionConfiguration,
} from "../core/execution-configuration";
import {
  evaluateRuntimeAttestation,
  type RuntimeAttestation,
} from "../core/runtime-attestation";
import {
  jointStateSnapshotSchema,
  ros2ProposalEnvelopeSchema,
  type JointTrajectoryAction,
  type Ros2ReferenceTransport,
} from "../ros2-reference-gateway";
import { RlsokCloudClient, verifyCloudEvidence } from "./client";
import { cloudContractVersion, type SubmitEvidence } from "./contract";
import { CloudConnectedDispatchBoundary } from "./gate";
import {
  InMemoryProposalReplayRegistry,
  type ProposalReplayRegistry,
} from "./replay-registry";

export interface CloudConnectedRos2Result {
  executionMode: "cloud-connected";
  mode: "shadow" | "run";
  releaseId: string;
  proposalId: string;
  decision: "allowed" | "blocked" | "failed";
  reason: string;
  cloudPermitId: string | null;
  cloudPermitConsumed: boolean;
  cloudPermitConsumptionState: "not_consumed" | "consumed" | "unknown";
  localPermitConsumed: boolean;
  controllerGoalsAttempted: number;
  hardwareSignalSent: boolean;
  cloudEvidenceId: string | null;
  evidenceVerified: boolean;
  controllerResult?: {
    accepted: boolean;
    completed: boolean;
    succeeded: boolean;
    status?: number;
    errorCode?: number;
    errorString?: string;
    detail: string;
  };
}

interface WorkflowOptions {
  mode: "shadow" | "run";
  release: ExecutablePolicySpec;
  cloud: RlsokCloudClient;
  transport: Ros2ReferenceTransport;
  controllerIdentity: string;
  executionConfiguration: () => Promise<ExecutionConfiguration | undefined>;
  runtimeAttestation?: () => Promise<RuntimeAttestation | undefined>;
  beforeFinalBoundary?: () => Promise<void>;
  localEvidence: (result: CloudConnectedRos2Result) => void | Promise<void>;
  /** Bounded in-memory replay registry; exhaustion fails closed. */
  maximumProposalIds?: number;
  /** Durable callers must inject a crash-persistent registry. */
  proposalReplayRegistry?: ProposalReplayRegistry;
  now?: () => Date;
}

interface EvidenceContext {
  contentHash: string;
  actionHash: string;
  deviceId: string;
  controllerId: string;
  expectedConfigurationDigest: string;
  observedConfigurationDigest: string | null;
}

const MAX_EVIDENCE_TEXT_LENGTH = 500;
const TRUNCATION_SUFFIX = ":truncated";

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundEvidenceText(value: string): string {
  const truncated = value.length > MAX_EVIDENCE_TEXT_LENGTH;
  const maximum = truncated
    ? MAX_EVIDENCE_TEXT_LENGTH - TRUNCATION_SUFFIX.length
    : MAX_EVIDENCE_TEXT_LENGTH;
  let result = "";
  for (let index = 0; index < value.length && result.length < maximum; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (result.length + 2 > maximum) break;
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\ufffd";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += "\ufffd";
    } else {
      result += value[index];
    }
  }
  return truncated ? `${result}${TRUNCATION_SUFFIX}` : result;
}

function boundEvidenceReason(reason: unknown): string {
  const value = typeof reason === "string" && reason.length > 0
    ? reason
    : "cloud_workflow_failed";
  return boundEvidenceText(value);
}

function normalizeControllerResult(response: unknown): {
  result: NonNullable<CloudConnectedRos2Result["controllerResult"]>;
  invalidReason: string | null;
} {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return {
      result: {
        accepted: false,
        completed: false,
        succeeded: false,
        detail: "controller_response_not_object",
      },
      invalidReason: "controller_result_invalid:response_not_object",
    };
  }

  const record = response as Record<string, unknown>;
  const violations: string[] = [];
  let accepted = false;
  if (typeof record.accepted === "boolean") {
    accepted = record.accepted;
  } else {
    violations.push("accepted_not_boolean");
  }
  let completed = false;
  if (typeof record.completed === "boolean") {
    completed = record.completed;
  } else if (record.completed !== undefined) {
    violations.push("completed_not_boolean");
  }
  let succeeded = false;
  if (typeof record.succeeded === "boolean") {
    succeeded = record.succeeded;
  } else if (record.succeeded !== undefined) {
    violations.push("succeeded_not_boolean");
  }

  let detail: string;
  if (typeof record.detail !== "string") {
    violations.push("detail_not_string");
    detail = "controller_response_detail_not_string";
  } else if (record.detail.length === 0) {
    violations.push("detail_empty");
    detail = "controller_response_detail_empty";
  } else if (!isUnicodeScalarString(record.detail)) {
    violations.push("detail_invalid_unicode");
    detail = boundEvidenceText(record.detail);
  } else if (record.detail.length > MAX_EVIDENCE_TEXT_LENGTH) {
    violations.push("detail_too_long");
    detail = boundEvidenceText(record.detail);
  } else {
    detail = record.detail;
  }

  let status: number | undefined;
  if (record.status !== undefined) {
    if (typeof record.status === "number" && Number.isSafeInteger(record.status)) {
      status = record.status;
    } else {
      violations.push("status_not_integer");
    }
  }

  let errorCode: number | undefined;
  if (record.errorCode !== undefined) {
    if (
      typeof record.errorCode === "number"
      && Number.isSafeInteger(record.errorCode)
    ) {
      errorCode = record.errorCode;
    } else {
      violations.push("error_code_not_integer");
    }
  }

  let errorString: string | undefined;
  if (record.errorString !== undefined) {
    if (typeof record.errorString !== "string") {
      violations.push("error_string_not_string");
    } else if (!isUnicodeScalarString(record.errorString)) {
      violations.push("error_string_invalid_unicode");
      errorString = boundEvidenceText(record.errorString);
    } else if (record.errorString.length > MAX_EVIDENCE_TEXT_LENGTH) {
      violations.push("error_string_too_long");
      errorString = boundEvidenceText(record.errorString);
    } else {
      errorString = record.errorString;
    }
  }

  return {
    result: {
      accepted,
      completed,
      succeeded,
      status,
      errorCode,
      errorString,
      detail,
    },
    invalidReason: violations.length > 0
      ? `controller_result_invalid:${violations.join(",")}`
      : null,
  };
}

export function assertLocalRos2Eligibility(
  release: ExecutablePolicySpec,
  proposal: ReturnType<typeof ros2ProposalEnvelopeSchema.parse>,
  controllerIdentity: string,
  mode: "shadow" | "run",
  now = new Date(),
): JointTrajectoryAction {
  if (release.evidence.status !== "approved") {
    throw new Error(
      release.evidence.status === "revoked"
        ? "release_revoked"
        : "release_not_approved",
    );
  }
  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(release.deployment.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) {
    throw new Error("release_time_invalid");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("release_expired");
  }
  if (
    (mode === "shadow" && release.deployment.mode !== "shadow") ||
    (mode === "run" && release.deployment.mode === "shadow")
  ) {
    throw new Error("release_deployment_mode_mismatch");
  }
  if (proposal.releaseId !== release.metadata.releaseId) {
    throw new Error("release_id_mismatch");
  }
  if (!release.deployment.allowedDeviceIds.includes(proposal.deviceId)) {
    throw new Error("device_not_allowed");
  }
  if (controllerIdentity !== release.robot.controllerConfigSha256) {
    throw new Error("controller_identity_mismatch");
  }
  const action = proposal.actionPayload;
  if (
    release.actionContract.representation !== "trajectory" ||
    action.jointNames.length !== release.actionContract.jointOrder.length ||
    !action.jointNames.every(
      (name, index) => name === release.actionContract.jointOrder[index],
    )
  ) {
    throw new Error("action_contract_mismatch");
  }
  return action;
}

export function assertFreshStateTimestamp(
  observedAt: string,
  maxStateAgeMs: number,
  now = new Date(),
): void {
  const stateAge = now.getTime() - Date.parse(observedAt);
  if (
    !Number.isFinite(stateAge) ||
    stateAge < 0 ||
    stateAge > maxStateAgeMs
  ) {
    throw new Error("state_stale_or_invalid");
  }
}

async function observeFreshJointState(
  transport: Ros2ReferenceTransport,
  release: ExecutablePolicySpec,
) {
  const state = jointStateSnapshotSchema.parse(
    await transport.getFreshJointState(release.runtimePolicy.maxStateAgeMs),
  );
  assertFreshStateTimestamp(
    state.observedAt,
    release.runtimePolicy.maxStateAgeMs,
  );
  if (
    !release.actionContract.jointOrder.every((name) => state.names.includes(name))
  ) {
    throw new Error("joint_state_order_mismatch");
  }
  return state;
}

export class CloudConnectedRos2Workflow {
  private readonly proposalReplayRegistry: ProposalReplayRegistry;

  constructor(private readonly options: WorkflowOptions) {
    if (options.mode === "run" && !options.proposalReplayRegistry) {
      throw new Error("proposal_replay_registry_required");
    }
    this.proposalReplayRegistry = options.proposalReplayRegistry
      ?? new InMemoryProposalReplayRegistry(options.maximumProposalIds ?? 65_536);
  }

  private async persistEvidence(
    result: CloudConnectedRos2Result,
    context: EvidenceContext,
    writeLocalEvidence: (
      result: CloudConnectedRos2Result,
    ) => void | Promise<void> = this.options.localEvidence,
  ): Promise<CloudConnectedRos2Result> {
    await writeLocalEvidence(result);
    const evidence: SubmitEvidence = {
      releaseId: result.releaseId,
      permitId: result.cloudPermitId,
      decision: result.decision,
      hardwareSignalSent: result.hardwareSignalSent,
      payload: {
        contractVersion: cloudContractVersion,
        evaluationMode:
          result.decision === "blocked"
            ? "denial"
            : this.options.mode === "shadow"
              ? "shadow"
              : "reference-run",
        contentHash: context.contentHash,
        actionHash: context.actionHash,
        deviceId: context.deviceId,
        controllerId: context.controllerId,
        expectedConfigurationDigest: context.expectedConfigurationDigest,
        observedConfigurationDigest: context.observedConfigurationDigest,
        localPermitConsumed: result.localPermitConsumed,
        cloudPermitConsumptionState: result.cloudPermitConsumptionState,
        controllerGoalsAttempted: result.controllerGoalsAttempted,
        reason: result.reason,
        controllerResult: result.controllerResult,
      },
    };
    const stored = await this.options.cloud.submitEvidence(evidence);
    const retrieved = await this.options.cloud.getEvidence(stored.evidenceId);
    const verified = verifyCloudEvidence(retrieved);
    if (!verified.ok) throw new Error(verified.reason);
    if (
      retrieved.id !== stored.evidenceId
      || retrieved.sequence !== stored.sequence
      || retrieved.previousHash !== stored.previousHash
      || retrieved.evidenceHash !== stored.evidenceHash
      || retrieved.createdAt !== stored.createdAt
      || retrieved.releaseId !== evidence.releaseId
      || retrieved.permitId !== (evidence.permitId ?? null)
      || retrieved.decision !== evidence.decision
      || retrieved.hardwareSignalSent !== evidence.hardwareSignalSent
      || canonicalJson(retrieved.payload) !== canonicalJson(evidence.payload)
    ) {
      throw new Error("evidence_receipt_mismatch");
    }
    result.cloudEvidenceId = stored.evidenceId;
    result.evidenceVerified = true;
    await writeLocalEvidence(result);
    return result;
  }

  async runProposal(payload: string): Promise<CloudConnectedRos2Result> {
    if (Buffer.byteLength(payload, "utf8") > 65_536) {
      throw new Error("proposal_payload_too_large");
    }
    const proposal = ros2ProposalEnvelopeSchema.parse(JSON.parse(payload));
    const action = assertLocalRos2Eligibility(
      this.options.release,
      proposal,
      this.options.controllerIdentity,
      this.options.mode,
      this.options.now?.() ?? new Date(),
    );
    const contentHash = executablePolicyHash(this.options.release);
    const actionHash = sha256(canonicalJson(action));
    const expectedConfigurationDigest =
      this.options.release.approvedConfigurationDigest;
    if (!expectedConfigurationDigest) {
      throw new Error("configuration_unbound");
    }
    let localEvidenceWritten = false;
    const writeLocalEvidence = async (result: CloudConnectedRos2Result) => {
      await this.options.localEvidence(result);
      localEvidenceWritten = true;
    };
    let latestResult: CloudConnectedRos2Result | undefined;
    const persistAttemptEvidence = (
      result: CloudConnectedRos2Result,
      context: EvidenceContext,
    ) => {
      const boundedResult = {
        ...result,
        reason: boundEvidenceReason(result.reason),
      };
      latestResult = boundedResult;
      return this.persistEvidence(boundedResult, context, writeLocalEvidence);
    };
    const replayClaim = this.proposalReplayRegistry.claim({
      releaseId: proposal.releaseId,
      executablePolicyHash: contentHash,
      deviceId: proposal.deviceId,
      proposerIdentity: proposal.proposerIdentity,
      proposalId: proposal.proposalId,
    });
    const replayDenial = replayClaim === "claimed"
      ? null
      : replayClaim === "duplicate"
        ? "proposal_id_duplicate"
        : replayClaim === "capacity_exceeded"
          ? "proposal_replay_registry_capacity_exceeded"
          : "proposal_replay_registry_unavailable";
    if (replayDenial) {
      return await persistAttemptEvidence(
        {
          executionMode: "cloud-connected",
          mode: this.options.mode,
          releaseId: this.options.release.metadata.releaseId,
          proposalId: proposal.proposalId,
          decision: "blocked",
          reason: replayDenial,
          cloudPermitId: null,
          cloudPermitConsumed: false,
          cloudPermitConsumptionState: "not_consumed",
          localPermitConsumed: false,
          controllerGoalsAttempted: 0,
          hardwareSignalSent: false,
          cloudEvidenceId: null,
          evidenceVerified: false,
        },
        {
          contentHash,
          actionHash,
          deviceId: proposal.deviceId,
          controllerId: this.options.controllerIdentity,
          expectedConfigurationDigest,
          observedConfigurationDigest: null,
        },
      );
    }
    let cloudPermitId: string | null = null;
    let controllerGoalsAttempted = 0;
    let controllerResult: CloudConnectedRos2Result["controllerResult"];
    try {
    const observeConfiguration = async () => {
      const observed = await this.options.executionConfiguration();
      return evaluateConfigurationBinding({
        approvedConfigurationDigest: expectedConfigurationDigest,
        observedConfiguration: observed,
        mode: this.options.mode,
        maxAgeMs:
          this.options.release.runtimePolicy.maxConfigurationAgeMs ?? 300_000,
      });
    };
    const requiredCapabilities =
      this.options.release.runtimePolicy.requiredCapabilities ?? [];
    const observeAttestation = async () => {
      let observed: RuntimeAttestation | undefined;
      if (requiredCapabilities.length > 0) {
        try {
          observed = await this.options.runtimeAttestation?.();
        } catch {
          observed = undefined;
        }
      }
      return evaluateRuntimeAttestation({
        requiredCapabilities,
        attestation: observed,
        maxAgeMs:
          this.options.release.runtimePolicy.maxAttestationAgeMs
          ?? this.options.release.runtimePolicy.maxStateAgeMs,
      });
    };
    const configuration = await observeConfiguration();
    const attestation = requiredCapabilities.length > 0
      ? await observeAttestation()
      : evaluateRuntimeAttestation({
          requiredCapabilities,
          maxAgeMs: this.options.release.runtimePolicy.maxStateAgeMs,
        });
    let latestConfiguration = configuration;
    const initial = await this.options.cloud.getRelease(
      this.options.release.metadata.releaseId,
    );
    let denialReason: string | null = null;
    if (initial.releaseId !== this.options.release.metadata.releaseId) {
      denialReason = "cloud_release_identity_mismatch";
    } else if (initial.contentHash !== contentHash) {
      denialReason = "cloud_release_content_hash_mismatch";
    } else if (initial.state !== "approved") {
      denialReason = `cloud_release_not_eligible:${initial.state}`;
    } else if (!configuration.allowed) {
      denialReason = configuration.reason;
    } else if (!attestation.allowed) {
      denialReason = attestation.reason;
    }
    if (denialReason) {
      return await persistAttemptEvidence(
        {
          executionMode: "cloud-connected",
          mode: this.options.mode,
          releaseId: this.options.release.metadata.releaseId,
          proposalId: proposal.proposalId,
          decision: "blocked",
          reason: denialReason,
          cloudPermitId: null,
          cloudPermitConsumed: false,
          cloudPermitConsumptionState: "not_consumed",
          localPermitConsumed: false,
          controllerGoalsAttempted: 0,
          hardwareSignalSent: false,
          cloudEvidenceId: null,
          evidenceVerified: false,
        },
        {
          contentHash,
          actionHash,
          deviceId: proposal.deviceId,
          controllerId: this.options.controllerIdentity,
          expectedConfigurationDigest,
          observedConfigurationDigest: configuration.observedDigest,
        },
      );
    }
    await observeFreshJointState(this.options.transport, this.options.release);
    const binding = {
      evaluationMode:
        this.options.mode === "shadow"
          ? ("shadow" as const)
          : ("reference-run" as const),
      releaseId: this.options.release.metadata.releaseId,
      contentHash,
      actionHash,
      deviceId: proposal.deviceId,
      controllerId: this.options.controllerIdentity,
      configurationDigest: configuration.observedDigest!,
    };
    const cloudPermit = await this.options.cloud.requestPermit({
      ...binding,
      expiresInSeconds: 30,
    });
    cloudPermitId = cloudPermit.permitId;
    const boundary = new CloudConnectedDispatchBoundary(
      this.options.cloud,
      cloudPermit.permitId,
      binding,
      {
        dispatch: async (candidate: JointTrajectoryAction) => {
          controllerGoalsAttempted += 1;
          const response = await this.options.transport.dispatchTrajectory(
            candidate,
            this.options.controllerIdentity,
          );
          const normalized = normalizeControllerResult(response);
          controllerResult = normalized.result;
          if (normalized.invalidReason) {
            throw new Error(normalized.invalidReason);
          }
          if (!controllerResult.accepted) {
            throw new Error(`controller_goal_rejected:${controllerResult.detail}`);
          }
          if (!controllerResult.completed) {
            throw new Error(
              `controller_result_unconfirmed:${controllerResult.detail}`,
            );
          }
          if (!controllerResult.succeeded) {
            throw new Error(
              `controller_goal_failed:${
                controllerResult.errorCode ?? "unknown"
              }:${controllerResult.detail}`,
            );
          }
          return response;
        },
        observeShadow: async () => ({
          accepted: true,
          detail: "shadow_adapter_observation_only",
        }),
      },
      async () => {
        const current = await observeConfiguration();
        latestConfiguration = current;
        if (!current.allowed) throw new Error(current.reason!);
        await observeFreshJointState(this.options.transport, this.options.release);
        if (requiredCapabilities.length > 0) {
          const currentAttestation = await observeAttestation();
          if (!currentAttestation.allowed) {
            throw new Error(currentAttestation.reason!);
          }
          if (
            canonicalJson(attestation.attestation?.source)
            !== canonicalJson(currentAttestation.attestation?.source)
          ) {
            throw new Error("runtime_attestation_changed");
          }
          if (
            attestation.attestation?.continuityToken
            !== currentAttestation.attestation?.continuityToken
          ) {
            throw new Error("runtime_continuity_changed");
          }
        }
        return current.observedDigest;
      },
      () => {
        assertLocalRos2Eligibility(
          this.options.release,
          proposal,
          this.options.controllerIdentity,
          this.options.mode,
          this.options.now?.() ?? new Date(),
        );
      },
    );
    const localPermit = boundary.issueLocalPermit(action);
    await this.options.beforeFinalBoundary?.();

    let decision: CloudConnectedRos2Result["decision"] = "allowed";
    let reason =
      this.options.mode === "shadow"
        ? "shadow_permit_evaluated_no_controller_call"
        : "controller_result_succeeded";
    let cloudPermitConsumed = false;
    let cloudPermitConsumptionState: CloudConnectedRos2Result["cloudPermitConsumptionState"] =
      "not_consumed";
    let localPermitConsumed = false;
    try {
      if (this.options.mode === "shadow") {
        await boundary.evaluateShadow(action, localPermit);
      } else {
        await boundary.dispatch(action, localPermit);
      }
    } catch (error) {
      decision = controllerGoalsAttempted > 0 ? "failed" : "blocked";
      reason = error instanceof Error ? error.message : "cloud_boundary_failed";
    }
    cloudPermitConsumed = boundary.cloudPermitWasConsumed;
    cloudPermitConsumptionState = boundary.cloudPermitConsumptionState;
    localPermitConsumed = boundary.localPermitWasConsumed;
    const hardwareSignalSent = controllerGoalsAttempted > 0;
    const result: CloudConnectedRos2Result = {
      executionMode: "cloud-connected",
      mode: this.options.mode,
      releaseId: binding.releaseId,
      proposalId: proposal.proposalId,
      decision,
      reason,
      cloudPermitId: cloudPermit.permitId,
      cloudPermitConsumed,
      cloudPermitConsumptionState,
      localPermitConsumed,
      controllerGoalsAttempted,
      hardwareSignalSent,
      cloudEvidenceId: null,
      evidenceVerified: false,
      controllerResult,
    };
    return await persistAttemptEvidence(result, {
      contentHash,
      actionHash,
      deviceId: binding.deviceId,
      controllerId: binding.controllerId,
      expectedConfigurationDigest,
      observedConfigurationDigest: latestConfiguration.observedDigest,
    });
    } catch (error) {
      if (localEvidenceWritten) throw error;
      if (latestResult) {
        await writeLocalEvidence(latestResult);
        throw error;
      }
      const reason = error instanceof Error
        ? boundEvidenceReason(error.message)
        : "cloud_workflow_failed";
      await writeLocalEvidence({
        executionMode: "cloud-connected",
        mode: this.options.mode,
        releaseId: this.options.release.metadata.releaseId,
        proposalId: proposal.proposalId,
        decision: controllerGoalsAttempted > 0 ? "failed" : "blocked",
        reason,
        cloudPermitId,
        cloudPermitConsumed: false,
        cloudPermitConsumptionState: "not_consumed",
        localPermitConsumed: false,
        controllerGoalsAttempted,
        hardwareSignalSent: controllerGoalsAttempted > 0,
        cloudEvidenceId: null,
        evidenceVerified: false,
        controllerResult,
      });
      throw error;
    }
  }
}

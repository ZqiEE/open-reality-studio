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
  ros2ProposalEnvelopeSchema,
  type JointTrajectoryAction,
  type Ros2ReferenceTransport,
} from "../ros2-reference-gateway";
import { RlsokCloudClient, verifyCloudEvidence } from "./client";
import { cloudContractVersion, type SubmitEvidence } from "./contract";
import { CloudConnectedDispatchBoundary } from "./gate";

export interface CloudConnectedRos2Result {
  executionMode: "cloud-connected";
  mode: "shadow" | "run";
  releaseId: string;
  proposalId: string;
  decision: "allowed" | "blocked" | "failed";
  reason: string;
  cloudPermitId: string | null;
  cloudPermitConsumed: boolean;
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
}

interface EvidenceContext {
  contentHash: string;
  actionHash: string;
  deviceId: string;
  controllerId: string;
  expectedConfigurationDigest: string;
  observedConfigurationDigest: string | null;
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
  if (Date.parse(release.deployment.expiresAt) <= now.getTime()) {
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

export class CloudConnectedRos2Workflow {
  private readonly seenProposalIds = new Set<string>();
  private readonly maximumProposalIds: number;

  constructor(private readonly options: WorkflowOptions) {
    this.maximumProposalIds = options.maximumProposalIds ?? 65_536;
    if (
      !Number.isInteger(this.maximumProposalIds) ||
      this.maximumProposalIds < 1 ||
      this.maximumProposalIds > 1_000_000
    ) {
      throw new Error("proposal_replay_registry_capacity_invalid");
    }
  }

  private async persistEvidence(
    result: CloudConnectedRos2Result,
    context: EvidenceContext,
  ): Promise<CloudConnectedRos2Result> {
    await this.options.localEvidence(result);
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
        controllerGoalsAttempted: result.controllerGoalsAttempted,
        reason: result.reason,
        controllerResult: result.controllerResult,
      },
    };
    const stored = await this.options.cloud.submitEvidence(evidence);
    const retrieved = await this.options.cloud.getEvidence(stored.evidenceId);
    const verified = verifyCloudEvidence(retrieved);
    if (!verified.ok) throw new Error(verified.reason);
    result.cloudEvidenceId = stored.evidenceId;
    result.evidenceVerified = true;
    await this.options.localEvidence(result);
    return result;
  }

  async runProposal(payload: string): Promise<CloudConnectedRos2Result> {
    const proposal = ros2ProposalEnvelopeSchema.parse(JSON.parse(payload));
    const action = assertLocalRos2Eligibility(
      this.options.release,
      proposal,
      this.options.controllerIdentity,
      this.options.mode,
    );
    const contentHash = executablePolicyHash(this.options.release);
    const actionHash = sha256(canonicalJson(action));
    const expectedConfigurationDigest =
      this.options.release.approvedConfigurationDigest;
    if (!expectedConfigurationDigest) {
      throw new Error("configuration_unbound");
    }
    let replayDenial: string | null = null;
    if (this.seenProposalIds.has(proposal.proposalId)) {
      replayDenial = "proposal_id_duplicate";
    } else if (this.seenProposalIds.size >= this.maximumProposalIds) {
      replayDenial = "proposal_replay_registry_capacity_exceeded";
    } else {
      this.seenProposalIds.add(proposal.proposalId);
    }
    if (replayDenial) {
      return this.persistEvidence(
        {
          executionMode: "cloud-connected",
          mode: this.options.mode,
          releaseId: this.options.release.metadata.releaseId,
          proposalId: proposal.proposalId,
          decision: "blocked",
          reason: replayDenial,
          cloudPermitId: null,
          cloudPermitConsumed: false,
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
      return this.persistEvidence(
        {
          executionMode: "cloud-connected",
          mode: this.options.mode,
          releaseId: this.options.release.metadata.releaseId,
          proposalId: proposal.proposalId,
          decision: "blocked",
          reason: denialReason,
          cloudPermitId: null,
          cloudPermitConsumed: false,
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
    const state = await this.options.transport.getFreshJointState(
      this.options.release.runtimePolicy.maxStateAgeMs,
    );
    assertFreshStateTimestamp(
      state.observedAt,
      this.options.release.runtimePolicy.maxStateAgeMs,
    );
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
    let controllerGoalsAttempted = 0;
    let controllerResult: CloudConnectedRos2Result["controllerResult"];
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
          if (!response.accepted) {
            throw new Error(`controller_goal_rejected:${response.detail}`);
          }
          controllerResult = {
            accepted: response.accepted,
            completed: response.completed === true,
            succeeded: response.succeeded === true,
            status: response.status,
            errorCode: response.errorCode,
            errorString: response.errorString,
            detail: response.detail,
          };
          if (response.completed !== true) {
            throw new Error(`controller_result_unconfirmed:${response.detail}`);
          }
          if (response.succeeded !== true) {
            throw new Error(`controller_goal_failed:${response.errorCode ?? "unknown"}:${response.detail}`);
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
    );
    const localPermit = boundary.issueLocalPermit(action);
    await this.options.beforeFinalBoundary?.();

    let decision: CloudConnectedRos2Result["decision"] = "allowed";
    let reason =
      this.options.mode === "shadow"
        ? "shadow_permit_evaluated_no_controller_call"
        : "controller_result_succeeded";
    let cloudPermitConsumed = false;
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
      localPermitConsumed,
      controllerGoalsAttempted,
      hardwareSignalSent,
      cloudEvidenceId: null,
      evidenceVerified: false,
      controllerResult,
    };
    return this.persistEvidence(result, {
      contentHash,
      actionHash,
      deviceId: binding.deviceId,
      controllerId: binding.controllerId,
      expectedConfigurationDigest,
      observedConfigurationDigest: latestConfiguration.observedDigest,
    });
  }
}

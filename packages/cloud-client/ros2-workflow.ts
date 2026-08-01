import {
  executablePolicyHash,
  type ExecutablePolicySpec,
} from "../core/exec-spec";
import { canonicalJson, sha256 } from "../core/evidence";
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
  beforeFinalBoundary?: () => Promise<void>;
  localEvidence: (result: CloudConnectedRos2Result) => void | Promise<void>;
}

function assertLocalEligibility(
  release: ExecutablePolicySpec,
  proposal: ReturnType<typeof ros2ProposalEnvelopeSchema.parse>,
  controllerIdentity: string,
): JointTrajectoryAction {
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

export class CloudConnectedRos2Workflow {
  constructor(private readonly options: WorkflowOptions) {}

  async runProposal(payload: string): Promise<CloudConnectedRos2Result> {
    const proposal = ros2ProposalEnvelopeSchema.parse(JSON.parse(payload));
    const action = assertLocalEligibility(
      this.options.release,
      proposal,
      this.options.controllerIdentity,
    );
    const contentHash = executablePolicyHash(this.options.release);
    const actionHash = sha256(canonicalJson(action));
    const initial = await this.options.cloud.getRelease(
      this.options.release.metadata.releaseId,
    );
    if (
      initial.releaseId !== this.options.release.metadata.releaseId ||
      initial.contentHash !== contentHash ||
      initial.state !== "approved"
    ) {
      throw new Error("cloud_release_not_eligible");
    }
    const state = await this.options.transport.getFreshJointState(
      this.options.release.runtimePolicy.maxStateAgeMs,
    );
    const stateAge = Date.now() - Date.parse(state.observedAt);
    if (
      !Number.isFinite(stateAge) ||
      stateAge < 0 ||
      stateAge > this.options.release.runtimePolicy.maxStateAgeMs
    ) {
      throw new Error("state_stale_or_invalid");
    }
    const binding = {
      releaseId: this.options.release.metadata.releaseId,
      contentHash,
      actionHash,
      deviceId: proposal.deviceId,
      controllerId: this.options.controllerIdentity,
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
    await this.options.localEvidence(result);

    const evidence: SubmitEvidence = {
      releaseId: binding.releaseId,
      permitId: cloudPermit.permitId,
      decision,
      hardwareSignalSent,
      payload: {
        contractVersion: cloudContractVersion,
        evaluationMode:
          decision === "blocked"
            ? "denial"
            : this.options.mode === "shadow"
              ? "shadow"
              : "reference-run",
        contentHash,
        actionHash,
        deviceId: binding.deviceId,
        controllerId: binding.controllerId,
        localPermitConsumed,
        controllerGoalsAttempted,
        reason,
        controllerResult,
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
}

/**
 * ReferenceServoPreflight — hardware-local dry-run logic for the reviewed
 * ESP32 + SG90 reference rig. It is extracted from the UI so the exact proposal
 * contract can be tested in isolation.
 *
 * It gives the REAL panel an exact, no-signal preview of its own 1-DOF intent:
 *   operator intent (angles)
 *     -> simulateServoTrack (the 1-DOF twin, using the authoritative rules)
 *     -> extractServoAngleTrack (strictly refuses non-servo sources)
 *     -> buildTeachManifest (an UNTRUSTED proposal)
 *
 * It STOPS there. It never validates-for-execution and never executes: the
 * REAL panel keeps doing what it already does with any proposal —
 * validateActionManifest, evidence lock, per-run operator confirmation, then
 * executeManifest over the existing IPC. This module adds ZERO IPC and ZERO
 * execution channel; it only prepares a preflight-verified proposal, and a
 * blocked preflight yields no proposal at all. It never consumes or certifies
 * the generic simulation model selected in the left workspace.
 */
import { simulateServoTrack, type ServoTwinResult } from './ServoTwinSimulation';
import { extractServoAngleTrack } from './ServoTwinAngleTrack';
import { buildTeachManifest } from './TeachMode';
import type { TaskDSL } from '../../types/taskDsl';
import type { ActionManifest } from '../action-manifest/ActionManifest';

export type BridgeStage = 'simulation' | 'bridge';

export interface RealProposalReady {
  ok: true;
  /** The simulation-verified angle track (identity-mapped to the real servo). */
  angles: number[];
  /** Authoritatively recomputed risk from the twin run. */
  riskLevel: TaskDSL['risk_level'];
  /** An UNTRUSTED proposal for the existing real path to validate + confirm. */
  manifest: unknown;
}

export interface RealProposalRejected {
  ok: false;
  /** Which span refused: the simulation twin, or the honesty bridge. */
  stage: BridgeStage;
  reason: string;
}

export type RealProposalResult = RealProposalReady | RealProposalRejected;

export interface PrepareProposalOptions {
  actionId?: string;
  displayName?: string;
  prompt?: string;
}

/**
 * Prepare a simulation-verified real-hardware proposal from an intended angle
 * sequence. Returns a rejection (never a partial proposal) if the twin blocks
 * the intent or the bridge refuses the run.
 */
export function prepareRealProposalFromIntent(
  angles: readonly number[],
  options: PrepareProposalOptions = {}
): RealProposalResult {
  const actionId = options.actionId ?? 'sim_bridge_command';
  const displayName = options.displayName ?? 'Simulation-verified command';

  // Simulation-first: the twin runs the authoritative rules. Blocked => no proposal.
  const twin: ServoTwinResult = simulateServoTrack(angles, {
    actionId,
    displayName,
    prompt: options.prompt ?? displayName
  });
  if (twin.status !== 'completed') {
    return { ok: false, stage: 'simulation', reason: twin.reason };
  }

  // Honest handoff: only a native 1-DOF servo track survives this.
  const bridged = extractServoAngleTrack({
    deviceProfileId: twin.deviceProfileId,
    runStatus: twin.status,
    adapterCommands: twin.adapterCommands
  });
  if (!bridged.ok) {
    return { ok: false, stage: 'bridge', reason: `${bridged.reason}: ${bridged.detail}` };
  }

  return {
    ok: true,
    angles: bridged.angles,
    riskLevel: twin.riskLevel,
    // Untrusted proposal. The panel revalidates + confirms + executes.
    manifest: buildTeachManifest(actionId, displayName, bridged.angles)
  };
}

export type ManifestAngleResult =
  | { ok: true; angles: number[] }
  | { ok: false; reason: string };

/**
 * Extract the servo angle track from an already-validated ActionManifest (e.g. a
 * saved teach action), so replaying it can be routed through the same
 * reference-servo preflight as a typed command. Refuses the WHOLE manifest if any
 * step is not a scalar move_to_angle — a saved sequence is never partially run.
 */
export function extractManifestAngles(manifest: ActionManifest): ManifestAngleResult {
  const angles: number[] = [];
  for (let index = 0; index < manifest.steps.length; index += 1) {
    const step = manifest.steps[index];
    if (step.action !== 'move_to_angle') {
      return { ok: false, reason: `step_${index}_not_move_to_angle:${step.action}` };
    }
    if (typeof step.value !== 'number' || !Number.isFinite(step.value)) {
      return { ok: false, reason: `step_${index}_non_numeric_angle` };
    }
    angles.push(step.value);
  }
  if (angles.length === 0) {
    return { ok: false, reason: 'no_steps' };
  }
  return { ok: true, angles };
}

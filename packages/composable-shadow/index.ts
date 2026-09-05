import { appendEvidence, type ChainedEvidence, type EvidenceBundle } from '../core/evidence';
import { executablePolicyHash, executablePolicySpecSchema } from '../core/exec-spec';
import { configurationDigest, executionConfigurationV2Schema } from '../core/execution-configuration';
import { ShadowExecutionGate } from '../core/execution-gate';
import {
  approvalSchema, atPointer, hashObject, observationSchema, profileHash, profileSchema,
  proposalBatchSchema, type Approval, type Observation, type Path, type Profile
} from './schema';
export * from './schema';

export function approveProfile(input: unknown, actor: string, expiresAt: string, now = new Date()): Approval {
  const profile = profileSchema.parse(input);
  return approvalSchema.parse({ schemaVersion: 1, scope: 'local-shadow-only',
    profileSha256: profileHash(profile), actor, approvedAt: now.toISOString(), expiresAt });
}

function configuration(p: Profile, path: Path, observation: Observation | undefined, now: string) {
  const actual = observation?.paths.find(a => a.id === path.id);
  const facts = path.checks.map(id => {
    const configured = p.facts.find(f => f.id === id)!;
    const observed = observation?.facts.find(f => f.id === id);
    const value = observation ? observed?.value : configured.expected;
    if (value === undefined) return null;
    return { kind: 'content' as const, sourceIdentity: `fact:${id}`, purpose: 'other' as const,
      contentSha256: configured.kind === 'file_sha256' ? value : hashObject(value) };
  });
  if (facts.includes(null) || (observation && !actual)) return undefined;
  // v2 binds semantics/provenance; environment must be explicitly in provenance
  // because v2 observation.environment is intentionally not identity-bearing.
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2, identity: { device: p.robot.deviceId, robot: p.robot.model },
    semanticContract: {
      command: { interfaceType: actual?.actionType ?? path.actionType, endpoint: actual?.endpoint ?? path.endpoint },
      controller: { implementation: p.robot.controller, version: 'composable-shadow/v1' },
      jointCommandMapping: p.jointOrder.map((joint, commandIndex) => ({ joint, commandIndex }))
    },
    provenance: [
      { kind: 'content', sourceIdentity: 'composition', purpose: 'controller_configuration', contentSha256: profileHash(p) },
      { kind: 'content', sourceIdentity: 'interface', purpose: 'controller_configuration', contentSha256: actual?.interfaceSha256 ?? path.interfaceSha256 },
      { kind: 'content', sourceIdentity: 'ros-environment', purpose: 'other', contentSha256: hashObject(observation?.environment ?? p.environment) },
      ...facts
    ],
    observation: { observedAt: observation?.observedAt ?? now, environment: {
      rosDistro: observation?.environment.rosDistro ?? p.environment.rosDistro,
      rmwImplementation: observation?.environment.rmwImplementation ?? p.environment.rmwImplementation
    } }
  });
}

const finiteVector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(n => typeof n === 'number' && Number.isFinite(n));

function poseVector(goal: Record<string, unknown>, mapping: string | string[], keys: string[]): unknown {
  if (Array.isArray(mapping)) return mapping.map(pointer => atPointer(goal, pointer));
  const value = atPointer(goal, mapping);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Object.keys(value).length === keys.length &&
      keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) {
    return keys.map(key => (value as Record<string, unknown>)[key]);
  }
  return undefined;
}

export function validateGoal(p: Profile, path: Path, goal: Record<string, unknown>): string | null {
  if (path.adapter === 'tp_program') {
    const program = atPointer(goal, path.fields.program);
    return typeof program === 'string' && path.fields.allowedPrograms.includes(program) ? null : 'program_not_allowlisted';
  }
  if (path.adapter === 'cartesian_pose') {
    const position = poseVector(goal, path.fields.position, ['x', 'y', 'z']);
    const orientation = poseVector(goal, path.fields.orientation, ['x', 'y', 'z', 'w']);
    if (!finiteVector(position, 3) || !finiteVector(orientation, 4)) return 'cartesian_pose_invalid';
    if (Math.abs(orientation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-6) return 'cartesian_quaternion_invalid';
    return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_frame_mismatch';
  }
  if (path.adapter === 'cartesian_delta') {
    const translation = path.fields.translation.map(pointer => atPointer(goal, pointer));
    const rotation = path.fields.rotation.map(pointer => atPointer(goal, pointer));
    const velocity = atPointer(goal, path.fields.velocity);
    if (!finiteVector(translation, 3) || !finiteVector(rotation, 3)) return 'cartesian_delta_invalid';
    if (translation.some(value => Math.abs(value) > path.fields.maxTranslationMm)) return 'cartesian_delta_translation_out_of_bounds';
    if (rotation.some(value => Math.abs(value) > path.fields.maxRotationDeg)) return 'cartesian_delta_rotation_out_of_bounds';
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity <= 0 || velocity > path.fields.maxVelocityMmS) return 'cartesian_delta_velocity_invalid';
    return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_delta_frame_mismatch';
  }
  if (hashObject(atPointer(goal, path.fields.jointNames) ?? null) !== hashObject(p.jointOrder)) return 'trajectory_joint_order_mismatch';
  const points = atPointer(goal, path.fields.points);
  if (!Array.isArray(points) || points.length < 1 || points.length > 10000) return 'trajectory_points_invalid';
  let previous = -1;
  for (const point of points) {
    if (!point || typeof point !== 'object' || !finiteVector(point.positions, p.jointOrder.length)) return 'trajectory_positions_invalid';
    for (const field of ['velocities', 'accelerations', 'effort']) {
      if (point[field] !== undefined && (!Array.isArray(point[field]) || (point[field].length !== 0 && !finiteVector(point[field], p.jointOrder.length)))) return 'trajectory_optional_vector_invalid';
    }
    const duration = point.time_from_start;
    if (!duration || !Number.isSafeInteger(duration.sec) || duration.sec < 0 || !Number.isInteger(duration.nanosec) || duration.nanosec < 0 || duration.nanosec >= 1e9) return 'trajectory_time_invalid';
    const current = duration.sec * 1e9 + duration.nanosec;
    if (!Number.isSafeInteger(current) || current <= previous) return 'trajectory_time_not_increasing';
    previous = current;
  }
  return null;
}

export interface Check { id: string; passed: boolean; reason: string; }

export async function evaluateProfile(input: {
  profile: unknown; approval: unknown; observation: unknown; proposals: unknown; now?: Date;
}) {
  const p = profileSchema.parse(input.profile);
  const a = approvalSchema.parse(input.approval);
  const o = observationSchema.parse(input.observation);
  const batch = proposalBatchSchema.parse(input.proposals);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
  const timestamp = now.toISOString();
  const fresh = (value: string) => { const age = now.getTime() - Date.parse(value); return age >= 0 && age <= p.maxObservationAgeMs; };
  const common: Check[] = [];
  const check = (list: Check[], id: string, passed: boolean, reason: string) => list.push({ id, passed, reason: passed ? 'matched' : reason });
  check(common, 'approval.profile', a.profileSha256 === profileHash(p), 'profile_changed_reapproval_required');
  check(common, 'approval.time', Date.parse(a.approvedAt) <= now.getTime() && Date.parse(a.expiresAt) > now.getTime(), 'approval_expired_or_future');
  check(common, 'observation.profile', o.profileId === p.id, 'observation_profile_mismatch');
  check(common, 'observation.freshness', fresh(o.observedAt), 'observation_stale_or_future');
  check(common, 'environment', hashObject(o.environment) === hashObject(p.environment), 'environment_mismatch');
  check(common, 'coverage', batch.proposals.length === p.paths.length && batch.proposals.every(b => p.paths.some(path => path.id === b.pathId)), 'declared_path_proposals_incomplete');
  check(common, 'observation.paths', o.paths.length === p.paths.length && o.paths.every(b => p.paths.some(path => path.id === b.id)), 'declared_path_observations_incomplete');
  check(common, 'observation.facts', o.facts.every(f => p.facts.some(expected => expected.id === f.id)), 'unexpected_fact');
  const results = [];
  for (const path of p.paths) {
    const checks = [...common];
    const actual = o.paths.find(item => item.id === path.id);
    check(checks, 'action.server', actual?.serverCount === 1, 'action_server_missing_or_ambiguous');
    check(checks, 'action.endpoint', actual?.endpoint === path.endpoint, 'action_endpoint_mismatch');
    check(checks, 'action.type', actual?.actionType === path.actionType, 'action_type_mismatch');
    check(checks, 'action.definition', actual?.interfaceSha256 === path.interfaceSha256, 'action_definition_mismatch');
    for (const id of path.checks) {
      const expected = p.facts.find(f => f.id === id)!;
      const observed = o.facts.find(f => f.id === id);
      check(checks, `fact.${id}.source`, observed?.kind === expected.kind, 'fact_missing_or_wrong_source');
      check(checks, `fact.${id}.freshness`, !!observed && fresh(observed.observedAt), 'fact_stale_or_future');
      check(checks, `fact.${id}.value`, observed?.value === expected.expected, `fact_mismatch:${id}`);
    }
    const proposal = batch.proposals.find(b => b.pathId === path.id);
    const goalError = proposal ? validateGoal(p, path, proposal.goal) : 'proposal_missing';
    check(checks, 'goal', goalError === null, goalError ?? 'matched');
    const expectedConfig = configuration(p, path, undefined, timestamp)!;
    let observedConfig;
    try { observedConfig = configuration(p, path, o, timestamp); } catch { /* malformed observed digest blocks */ }
    const binding = configurationDigest(expectedConfig);
    const profileDigest = profileHash(p);
    const assessment = { schemaVersion: 1, kind: 'LocalShadowInputAssessment', assessedAt: timestamp,
      profileSha256: profileDigest, observationSha256: hashObject(o), proposalsSha256: hashObject(batch), pathId: path.id, checks };
    const spec = executablePolicySpecSchema.parse({
      apiVersion: 'realitywarden.io/v1alpha1', kind: 'ExecutablePolicy',
      metadata: { name: `${p.id}.${path.id}`, releaseId: `${p.id}.${path.id}.${a.profileSha256.slice(0, 16)}`, createdAt: a.approvedAt },
      model: { artifact: 'profile.json', sha256: profileDigest, framework: 'ros2', policyType: `shadow/${path.adapter}`, codeRevision: 'composable-shadow/v1' },
      actionContract: { representation: path.adapter === 'joint_trajectory' ? 'trajectory' : path.adapter === 'tp_program' ? 'program' : path.adapter,
        dimension: path.adapter === 'joint_trajectory' ? p.jointOrder.length : path.adapter === 'cartesian_pose' ? 7 : path.adapter === 'cartesian_delta' ? 6 : 1,
        jointOrder: path.adapter === 'joint_trajectory' ? p.jointOrder : [],
        units: { position: path.adapter === 'joint_trajectory' ? 'radian' : path.adapter === 'cartesian_pose' ? 'meter' : path.adapter === 'cartesian_delta' ? 'millimeter' : 'none',
          velocity: path.adapter === 'joint_trajectory' ? 'radian_per_second' : path.adapter === 'cartesian_delta' ? 'mm_per_second' : 'none' },
        normalizerSha256: hashObject(path.fields), preprocessorSha256: hashObject(path.adapter), postprocessorSha256: hashObject('zero-dispatch') },
      robot: { profileId: p.id, profileSha256: profileDigest, urdfSha256: p.robot.urdfSha256, controllerType: p.robot.controller, controllerConfigSha256: binding },
      runtimePolicy: { policySha256: profileDigest, maxStateAgeMs: p.maxObservationAgeMs, maxConfigurationAgeMs: p.maxObservationAgeMs, failClosed: true },
      executionConfiguration: expectedConfig, approvedConfigurationDigest: binding,
      evidence: { scenarioPackId: 'local-composable-shadow/v1', testReportSha256: hashObject(assessment),
        status: 'approved', approvedBy: a.actor, approvedAt: a.approvedAt },
      deployment: { allowedDeviceIds: [p.robot.deviceId], mode: 'shadow', expiresAt: a.expiresAt }
    });
    const identity = executablePolicyHash(spec);
    const entries: ChainedEvidence[] = [];
    const gate = new ShadowExecutionGate<Record<string, unknown>, Observation>(
      { append(evidence) { entries.push(appendEvidence(entries, evidence)); } },
      async () => ({ allowed: checks.every(c => c.passed), reason: checks.find(c => !c.passed)?.reason ?? 'composable_profile_matched', matchedRuleIds: checks.map(c => c.id) }),
      hashObject
    );
    // The envelope contains the goal hash, not customer program/pose data.
    const action = { pathId: path.id, adapter: path.adapter, goalSha256: hashObject(proposal?.goal ?? {}) };
    await gate.evaluate({
      release: spec, releaseRecord: { releaseId: spec.metadata.releaseId, state: 'shadow', executablePolicyHash: identity,
        approvedIdentityHash: identity, approvedConfigurationDigest: binding, approvedAt: a.approvedAt, approvedBy: a.actor },
      deviceId: p.robot.deviceId, proposalId: proposal?.id ?? `missing-${path.id}`, action, actionHash: hashObject(action),
      state: o,
      // A future timestamp is invalid input, not a real state observation time.
      // The assessment retains its input hash and failure; Evidence must not
      // assert a future state existed before this decision was made.
      stateObservedAt: Date.parse(o.observedAt) <= now.getTime() ? o.observedAt : undefined,
      executionConfiguration: observedConfig, now
    });
    const evidence: EvidenceBundle = { apiVersion: 'realitywarden.io/v1alpha1', kind: 'EvidenceBundle',
      releaseId: spec.metadata.releaseId, executablePolicyHash: identity, createdAt: timestamp, entries, testReportSha256: spec.evidence.testReportSha256 };
    const decision = entries[0]!.evidence;
    results.push({ pathId: path.id, adapter: path.adapter, decision: decision.decision === 'allowed' ? 'WOULD_ALLOW' : 'WOULD_BLOCK',
      reason: checks.find(c => !c.passed)?.reason ?? decision.decisionReason, checks,
      expectedConfigurationDigest: binding, observedConfigurationDigest: observedConfig ? configurationDigest(observedConfig) : null,
      assessment, release: spec, evidence });
  }
  return {
    schemaVersion: 1 as const, kind: 'ComposableShadowReport' as const, profileId: p.id, profileSha256: profileHash(p),
    evaluatedAt: timestamp, collector: o.collector, assurance: 'LOCAL_SELF_ATTESTED' as const,
    coverage: 'declared_paths_only' as const, cloudUploaded: false as const,
    hardwareSignalSent: false as const, controllerGoalsAttempted: 0 as const,
    decision: results.every(r => r.decision === 'WOULD_ALLOW') ? 'WOULD_ALLOW' : 'WOULD_BLOCK', results,
    limitations: [
      'Shadow evaluation only: no hardware dispatch or production execution permit.',
      'Local approval and observation files are operator-supplied, not authenticated Cloud approval or hardware attestation.',
      'Graph discovery confirms visible server nodes, not physical robot identity or all possible execution paths.',
      'File hashes prove local file content; timestamped JSON facts require a trusted read-only exporter of active controller state.',
      'Goal adapters check declared fields and configuration eligibility, not complete ROS serialization or physical motion safety.'
    ]
  };
}

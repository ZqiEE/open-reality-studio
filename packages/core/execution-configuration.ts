import { z } from 'zod';
import { canonicalJson, sha256 } from './evidence';

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().trim().min(1).max(512);

export const executionConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  deviceIdentity: identity,
  robotIdentity: identity,
  rosDistro: identity,
  rmwImplementation: identity,
  jointState: z.object({
    topic: identity,
    messageType: z.literal('sensor_msgs/msg/JointState')
  }).strict(),
  controller: z.object({
    name: identity,
    followJointTrajectoryAction: identity,
    actionType: z.literal('control_msgs/action/FollowJointTrajectory')
  }).strict(),
  jointOrder: z.array(identity).min(1).max(256),
  adapter: z.object({
    identity,
    version: identity
  }).strict(),
  observedAt: timestamp,
  metadata: z.object({
    friendlyName: z.string().max(512).optional(),
    description: z.string().max(4_096).optional(),
    ui: z.record(z.unknown()).optional()
  }).strict().optional()
}).strict().superRefine((configuration, context) => {
  if (new Set(configuration.jointOrder).size !== configuration.jointOrder.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['jointOrder'],
      message: 'joint order must contain unique names'
    });
  }
});

export type ExecutionConfiguration = z.infer<typeof executionConfigurationSchema>;

export type ConfigurationBindingReason =
  | 'configuration_mismatch'
  | 'configuration_missing'
  | 'configuration_stale'
  | 'configuration_unbound';

export interface ConfigurationBindingEvaluation {
  allowed: boolean;
  reason: ConfigurationBindingReason | null;
  expectedDigest: string | null;
  observedDigest: string | null;
  legacyUnbound: boolean;
}

function securityCriticalConfiguration(configuration: ExecutionConfiguration): unknown {
  return {
    schemaVersion: configuration.schemaVersion,
    deviceIdentity: configuration.deviceIdentity,
    robotIdentity: configuration.robotIdentity,
    rosDistro: configuration.rosDistro,
    rmwImplementation: configuration.rmwImplementation,
    jointState: configuration.jointState,
    controller: configuration.controller,
    jointOrder: configuration.jointOrder,
    adapter: configuration.adapter
  };
}

export function configurationDigest(configuration: ExecutionConfiguration): string {
  const parsed = executionConfigurationSchema.parse(configuration);
  return sha256(canonicalJson(securityCriticalConfiguration(parsed)));
}

export function evaluateConfigurationBinding(input: {
  approvedConfigurationDigest?: string;
  observedConfiguration?: ExecutionConfiguration;
  mode: 'shadow' | 'run';
  maxAgeMs: number;
  now?: Date;
}): ConfigurationBindingEvaluation {
  const observed = input.observedConfiguration
    ? executionConfigurationSchema.safeParse(input.observedConfiguration)
    : null;
  const observedDigest = observed?.success
    ? configurationDigest(observed.data)
    : null;
  if (!input.approvedConfigurationDigest) {
    return {
      allowed: input.mode === 'shadow',
      reason: 'configuration_unbound',
      expectedDigest: null,
      observedDigest,
      legacyUnbound: true
    };
  }
  if (!observed?.success) {
    return {
      allowed: false,
      reason: 'configuration_missing',
      expectedDigest: input.approvedConfigurationDigest,
      observedDigest: null,
      legacyUnbound: false
    };
  }
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(observed.data.observedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > input.maxAgeMs) {
    return {
      allowed: false,
      reason: 'configuration_stale',
      expectedDigest: input.approvedConfigurationDigest,
      observedDigest,
      legacyUnbound: false
    };
  }
  if (observedDigest !== input.approvedConfigurationDigest) {
    return {
      allowed: false,
      reason: 'configuration_mismatch',
      expectedDigest: input.approvedConfigurationDigest,
      observedDigest,
      legacyUnbound: false
    };
  }
  return {
    allowed: true,
    reason: null,
    expectedDigest: input.approvedConfigurationDigest,
    observedDigest,
    legacyUnbound: false
  };
}

import { z } from 'zod';
import { canonicalJson, sha256 } from './evidence';

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().trim().min(1).max(512);
const version = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/, 'expected lowercase SHA-256');
const annotationValue = z.union([
  z.string().max(1_024),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueAnnotations(label: string, maximum: number) {
  return z.array(z.object({
    name: z.string().trim().min(1).max(256),
    value: annotationValue
  }).strict()).max(maximum).superRefine((entries, context) => {
    if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must contain unique names`
      });
    }
  });
}

/** ExecutionConfiguration v1 is intentionally frozen. */
export const executionConfigurationV1Schema = z.object({
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

const provenancePurpose = z.enum([
  'controller_configuration',
  'robot_description',
  'calibration',
  'limits',
  'frame_contract',
  'other'
]);

const provenanceSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('content'),
    sourceIdentity: identity,
    purpose: provenancePurpose,
    contentSha256: hash
  }).strict(),
  z.object({
    kind: z.literal('software'),
    sourceIdentity: identity,
    purpose: provenancePurpose,
    version
  }).strict(),
  z.object({
    kind: z.literal('generated'),
    sourceIdentity: identity,
    purpose: provenancePurpose,
    inputSha256: hash,
    generator: z.object({
      identity,
      version
    }).strict()
  }).strict()
]);

const provenanceSchema = z.array(provenanceSourceSchema).min(1).max(256)
  .superRefine((entries, context) => {
    if (new Set(entries.map((entry) => entry.sourceIdentity)).size !== entries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provenance entries must have unique sourceIdentity values'
      });
    }
  })
  .transform((entries) => [...entries].sort((left, right) => (
    compareText(left.sourceIdentity, right.sourceIdentity)
  )));

const jointCommandMappingSchema = z.array(z.object({
  joint: identity,
  commandIndex: z.number().int().min(0).max(255)
}).strict()).min(1).max(256).superRefine((entries, context) => {
  if (new Set(entries.map((entry) => entry.joint)).size !== entries.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'joint command mapping must contain unique joint names'
    });
  }
  if (new Set(entries.map((entry) => entry.commandIndex)).size !== entries.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'joint command mapping must contain unique command indexes'
    });
  }
}).transform((entries) => [...entries].sort((left, right) => (
  left.commandIndex - right.commandIndex
)));

export const executionConfigurationV2Schema = z.object({
  schemaVersion: z.literal(2),
  identity: z.object({
    device: identity,
    robot: identity
  }).strict(),
  semanticContract: z.object({
    command: z.object({
      interfaceType: identity,
      endpoint: z.string().trim().min(1).max(1_024)
    }).strict(),
    controller: z.object({
      implementation: identity,
      version
    }).strict(),
    jointCommandMapping: jointCommandMappingSchema,
    limitsDigest: hash.optional(),
    frameContractDigest: hash.optional()
  }).strict(),
  provenance: provenanceSchema,
  observation: z.object({
    observedAt: timestamp,
    environment: z.object({
      rosDistro: identity.optional(),
      rmwImplementation: identity.optional()
    }).strict().optional(),
    discovery: uniqueAnnotations('discovery entries', 256).optional(),
    diagnostics: uniqueAnnotations('diagnostic entries', 256).optional()
  }).strict(),
  display: z.object({
    friendlyName: z.string().max(512).optional(),
    description: z.string().max(4_096).optional(),
    ui: uniqueAnnotations('UI entries', 128).optional()
  }).strict().optional()
}).strict();

export const executionConfigurationSchema = z.union([
  executionConfigurationV1Schema,
  executionConfigurationV2Schema
]);

export type ExecutionConfigurationV1 = z.infer<typeof executionConfigurationV1Schema>;
export type ExecutionConfigurationV2 = z.infer<typeof executionConfigurationV2Schema>;
export type ExecutionConfiguration = z.infer<typeof executionConfigurationSchema>;
export type ExecutionConfigurationSchemaVersion = ExecutionConfiguration['schemaVersion'];

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

function securityCriticalV1(configuration: ExecutionConfigurationV1): unknown {
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

function securityCriticalV2(configuration: ExecutionConfigurationV2): unknown {
  return {
    schemaVersion: configuration.schemaVersion,
    identity: configuration.identity,
    semanticContract: configuration.semanticContract,
    provenance: configuration.provenance
  };
}

export function configurationDigest(configuration: ExecutionConfiguration): string {
  const parsed = executionConfigurationSchema.parse(configuration);
  const projection = parsed.schemaVersion === 1
    ? securityCriticalV1(parsed)
    : securityCriticalV2(parsed);
  return sha256(canonicalJson(projection));
}

export function configurationObservedAt(configuration: ExecutionConfiguration): string {
  const parsed = executionConfigurationSchema.parse(configuration);
  return parsed.schemaVersion === 1
    ? parsed.observedAt
    : parsed.observation.observedAt;
}

/**
 * Preserve the historical full v1 ExecSpec identity while making v2 approval
 * identity match the v2 security-critical digest projection.
 */
export function executableConfigurationIdentity(
  configuration: ExecutionConfiguration | undefined
): unknown {
  if (!configuration) return undefined;
  const parsed = executionConfigurationSchema.parse(configuration);
  return parsed.schemaVersion === 1
    ? parsed
    : { schemaVersion: 2, configurationDigest: configurationDigest(parsed) };
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
  const ageMs = now.getTime() - Date.parse(configurationObservedAt(observed.data));
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

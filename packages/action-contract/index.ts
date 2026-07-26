import { z } from 'zod';
import { sha256, canonicalJson } from '../evidence';

const rangeSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite()
}).strict().refine((range) => range.min <= range.max, 'range min must not exceed max');

export const actionContractSchema = z.object({
  apiVersion: z.literal('realitywarden.io/v1alpha1'),
  kind: z.literal('ActionContract'),
  metadata: z.object({
    name: z.string().min(1),
    version: z.string().min(1)
  }).strict(),
  representation: z.enum([
    'joint_position',
    'joint_velocity',
    'cartesian_pose',
    'twist',
    'trajectory'
  ]),
  dimension: z.number().int().positive(),
  jointOrder: z.array(z.string().min(1)),
  units: z.object({
    position: z.enum(['radian', 'degree', 'meter', 'millimeter']),
    velocity: z.string().min(1)
  }).strict(),
  parameterRanges: z.record(rangeSchema),
  requiredState: z.array(z.string().min(1)),
  executionMode: z.enum(['single', 'sequence', 'stream']),
  constraints: z.array(z.string().min(1))
}).strict().superRefine((contract, context) => {
  if (
    contract.representation.startsWith('joint_')
    && contract.jointOrder.length !== contract.dimension
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['jointOrder'],
      message: 'jointOrder length must equal dimension'
    });
  }
});

export type ActionContract = z.infer<typeof actionContractSchema>;

export function hashActionContract(contract: ActionContract): string {
  return sha256(canonicalJson(actionContractSchema.parse(contract)));
}

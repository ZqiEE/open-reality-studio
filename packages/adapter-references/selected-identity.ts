import { z } from 'zod';

const identity = z.string().trim().min(1).max(512);

export const selectedIdentityReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  integration: identity,
  status: z.literal('reference-contract'),
  stableApprovedInputs: z.array(identity).min(1),
  runtimeCapabilities: z.array(identity),
  excludedVolatileInputs: z.array(identity),
  mismatchBehavior: z.literal('block-before-dispatch'),
  externalTestGate: identity
}).strict();

export type SelectedIdentityReference = z.infer<typeof selectedIdentityReferenceSchema>;

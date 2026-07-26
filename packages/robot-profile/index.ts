import { z } from 'zod';
import { canonicalJson, sha256 } from '../evidence';

export const robotProfileSchema = z.object({
  apiVersion: z.literal('realitywarden.io/v1alpha1'),
  kind: z.literal('RobotProfile'),
  profileId: z.string().min(1),
  urdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  jointOrder: z.array(z.string().min(1)),
  controllerTypes: z.array(z.string().min(1)).min(1)
}).strict();

export type RobotProfile = z.infer<typeof robotProfileSchema>;

export function hashRobotProfile(profile: RobotProfile): string {
  return sha256(canonicalJson(robotProfileSchema.parse(profile)));
}

/** Compatibility adapter; it does not approve or authorize the legacy asset. */
export class LegacyDeviceManifestAdapter {
  static toRobotProfile(input: {
    id: string;
    joints?: string[];
    controllerType: string;
    urdfSha256: string;
  }): RobotProfile {
    return robotProfileSchema.parse({
      apiVersion: 'realitywarden.io/v1alpha1',
      kind: 'RobotProfile',
      profileId: input.id,
      urdfSha256: input.urdfSha256,
      jointOrder: input.joints ?? [],
      controllerTypes: [input.controllerType]
    });
  }
}

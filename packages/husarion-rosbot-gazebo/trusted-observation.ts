import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '../core/evidence';
import {
  executionConfigurationV2Schema,
  type ExecutionConfigurationV2
} from '../core/execution-configuration';
import {
  HUSARION_ROSBOT_COMMAND_CHANNELS,
  HUSARION_ROSBOT_COMMAND_TOPIC,
  HUSARION_ROSBOT_CONTROLLER,
  HUSARION_ROSBOT_MESSAGE_TYPE
} from './index';

export const HUSARION_ROSBOT_CONTROLLERS_SOURCE =
  'husarion/rosbot_ros/rosbot_controller/config/rosbot/controllers.yaml';
export const HUSARION_ROSBOT_CONTROLLER_VERSION = 'jazzy@7c7bfa449011';

export interface TrustedHusarionObservationInput {
  controllerConfigPath: string;
  deviceIdentity: string;
  robotIdentity: string;
  now?: Date;
}

/**
 * Produces a complete trusted v2 observation from operator identity and the
 * controller file currently present in the workspace. No approved release is
 * accepted as input, so approved identity/provenance cannot become observed fact.
 */
export function observeTrustedHusarionConfiguration(
  input: TrustedHusarionObservationInput
): { configuration: ExecutionConfigurationV2; controllerIdentity: string } {
  const controllerBytes = readFileSync(resolve(input.controllerConfigPath));
  const controllerIdentity = sha256(controllerBytes);
  const configuration = executionConfigurationV2Schema.parse({
    schemaVersion: 2,
    identity: {
      device: input.deviceIdentity,
      robot: input.robotIdentity
    },
    semanticContract: {
      command: {
        interfaceType: HUSARION_ROSBOT_MESSAGE_TYPE,
        endpoint: HUSARION_ROSBOT_COMMAND_TOPIC
      },
      controller: {
        implementation: HUSARION_ROSBOT_CONTROLLER,
        version: HUSARION_ROSBOT_CONTROLLER_VERSION
      },
      jointCommandMapping: HUSARION_ROSBOT_COMMAND_CHANNELS.map((joint, commandIndex) => ({
        joint,
        commandIndex
      }))
    },
    provenance: [{
      kind: 'content',
      sourceIdentity: HUSARION_ROSBOT_CONTROLLERS_SOURCE,
      purpose: 'controller_configuration',
      contentSha256: controllerIdentity
    }],
    observation: {
      observedAt: (input.now ?? new Date()).toISOString()
    }
  });
  return { configuration, controllerIdentity };
}

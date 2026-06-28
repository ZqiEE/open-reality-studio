import type { DeviceManifest, WorldModel } from '../lib/open-reality-protocol';
import { getCapabilityContracts } from '../lib/open-reality-runtime/capabilityContract';

/**
 * Fictional onboarding example.
 * Keep it simulation-only and keep the real adapter disabled.
 */
export const simpleSensorDeviceManifest: DeviceManifest = {
  deviceId: 'simple_sensor_01',
  displayName: 'Simple Sensor',
  category: 'sensor',
  supportLevel: 'simulation_only',
  capabilities: getCapabilityContracts(['read_sensor', 'inspect', 'record']),
  workspace: {
    allowedZones: ['inspection_zone', 'current_area', 'zone_a'],
    forbiddenZones: ['outside_table', 'restricted_zone']
  },
  constraints: {
    maxSpeed: 'slow',
    maxForce: 'low',
    precisionLevel: 'low',
    requiresCollisionCheck: false,
    requiresSimulation: true,
    requiresHumanApproval: false
  },
  riskProfile: {
    baseRisk: 'low',
    hazardousCapabilities: [],
    blockedGoals: ['throw_object', 'smash_object', 'move_outside_workspace', 'destructive_action']
  },
  adapter: {
    simulationAdapter: 'simple_sensor.simulation',
    realAdapterEnabled: false
  }
};

export const simpleSensorWorldModel: WorldModel = {
  objects: [],
  zones: [
    { id: 'inspection_zone', label: 'Inspection Zone', safe: true },
    { id: 'current_area', label: 'Current Area', safe: true },
    { id: 'zone_a', label: 'Zone A', safe: true }
  ],
  devices: [
    {
      deviceId: simpleSensorDeviceManifest.deviceId,
      status: 'selected',
      selected: true,
      supportLevel: simpleSensorDeviceManifest.supportLevel
    }
  ],
  confidence: 'high'
};

export const simpleSensorOnboardingChecklist = {
  worldModelAssumptions: [
    'The device is stationary and observes a fixed area.',
    'Only read-oriented tasks are expected in the first simulation path.',
    'No real hardware transport is enabled.'
  ],
  simulationAdapter: {
    mode: 'simulation_only',
    dryRunOnly: true
  },
  safetyProfile: {
    requiresHumanApproval: false,
    blockedGoals: simpleSensorDeviceManifest.riskProfile.blockedGoals
  },
  requiredTests: [
    'manifest loads',
    'realAdapterEnabled is false',
    'supported read prompt compiles',
    'unsupported actuation prompt does not execute'
  ]
} as const;

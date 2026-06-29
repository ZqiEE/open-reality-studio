import { getOpenRealityDeviceManifest } from '../open-reality-runtime/deviceManifests';
import type { RuntimeDeviceType, WorldModel } from '../open-reality-runtime/types';
import type {
  RealityAssetAdapterBoundary,
  RealityAssetExamplePrompts,
  RealityAssetPackage,
  RealityAssetValidationRules
} from './types';

const defaultZones: WorldModel['zones'] = [
  { id: 'pickup_zone', label: 'Pickup Zone', safe: true },
  { id: 'left_safe_zone', label: 'Left Safe Zone', safe: true },
  { id: 'right_safe_zone', label: 'Right Safe Zone', safe: true },
  { id: 'front_safe_zone', label: 'Front Safe Zone', safe: true },
  { id: 'back_safe_zone', label: 'Back Safe Zone', safe: true },
  { id: 'outside_table', label: 'Outside Table', safe: false },
  { id: 'current_area', label: 'Current Area', safe: true }
];

const validationRules: RealityAssetValidationRules = {
  requiresDeviceManifest: true,
  requiresCapabilityContracts: true,
  requiresSupportLevel: true,
  realAdapterMustBeDisabled: true,
  comingSoonMustNotBeRunnable: true,
  unsupportedMustNotFallback: true,
  requiresExamplePrompt: true
};

function adapterBoundary(deviceType: RuntimeDeviceType): RealityAssetAdapterBoundary {
  const manifest = getOpenRealityDeviceManifest(deviceType);
  const simulationRunnable = manifest.supportLevel === 'simulation_only';
  const readOnly = manifest.supportLevel === 'read_only';
  return {
    simulationAdapterAvailable: simulationRunnable,
    readOnlyAdapterAvailable: readOnly,
    realAdapterEnabled: false,
    adapterMode: readOnly ? 'read_only' : simulationRunnable ? 'simulation_only' : 'real_disabled',
    taskDslIsHardwareCommand: false,
    notes: [
      simulationRunnable || readOnly
        ? 'TaskDSL may enter the local simulation/read-only adapter boundary only.'
        : 'This asset is inspectable but not runnable in the Public Alpha runtime.',
      'TaskDSL is not a hardware command.',
      'Real device adapters are a future boundary and remain disabled.'
    ]
  };
}

function prompts(deviceType: RuntimeDeviceType): RealityAssetExamplePrompts {
  if (deviceType === 'robot_arm') {
    return {
      supported: ['Move the red cube to the back safe zone.', 'Move the red cube to the left safe zone.'],
      unsupported: ['Assemble the gearbox.'],
      unsafe: ['Throw the red cube off the table.'],
      ambiguous: ['Move the cube to the safe zone.']
    };
  }
  if (deviceType === 'smart_light') {
    return {
      supported: ['Turn on the light.', 'Set the light to blue.'],
      unsupported: ['Make the light purple.'],
      unsafe: ['Flash the light at unsafe speed.'],
      ambiguous: ['Adjust the light.']
    };
  }
  if (deviceType === 'camera_sensor') {
    return {
      supported: ['Take a photo.', 'Read camera status.'],
      unsupported: ['Track every person in the room.'],
      unsafe: ['Capture the privacy zone.'],
      ambiguous: ['Check the camera.']
    };
  }
  return {
    supported: ['Inspect this device asset.'],
    unsupported: ['Run this device now.'],
    unsafe: ['Bypass safety and execute.'],
    ambiguous: ['Do the normal task.']
  };
}

function worldModelObjects(deviceType: RuntimeDeviceType): WorldModel['objects'] {
  if (deviceType === 'robot_arm') {
    return [
      { id: 'red_cube', type: 'cube', color: 'red', zone: 'pickup_zone', pose: [0, 0, 0], movable: true },
      { id: 'table_workspace', type: 'workspace', zone: 'table_workspace', movable: false }
    ];
  }
  if (deviceType === 'smart_light') {
    return [{ id: 'light_panel', type: 'smart_light_panel', zone: 'current_area', movable: false }];
  }
  if (deviceType === 'camera_sensor') {
    return [{ id: 'camera_view', type: 'sensor_view', zone: 'current_area', movable: false }];
  }
  return [{ id: `${deviceType}_placeholder`, type: deviceType, zone: 'current_area', movable: false }];
}

function asset(deviceType: RuntimeDeviceType, name: string): RealityAssetPackage {
  const manifest = getOpenRealityDeviceManifest(deviceType);
  return {
    assetId: `openreality.${deviceType}`,
    name,
    version: '0.2.0-sprint.1',
    vendor: 'open-reality',
    description: `${name} packaged as a local Reality Asset for simulation-first runtime inspection.`,
    deviceType,
    deviceManifest: manifest,
    capabilityContracts: manifest.capabilities,
    worldModelAssumptions: {
      objects: worldModelObjects(deviceType),
      zones: defaultZones,
      confidence: manifest.supportLevel === 'coming_soon' ? 'medium' : 'high'
    },
    adapterBoundary: adapterBoundary(deviceType),
    examplePrompts: prompts(deviceType),
    validationRules,
    supportLevel: manifest.supportLevel,
    safetyNotes: [
      'Simulation-first Public Alpha asset.',
      'Real device execution is disabled.',
      manifest.supportLevel === 'coming_soon'
        ? 'This device is protocol-shaped but not runnable.'
        : 'This device can enter only the local simulation/read-only runtime boundary.'
    ],
    tags: ['builtin', manifest.supportLevel, manifest.category]
  };
}

export const BUILTIN_REALITY_ASSETS: RealityAssetPackage[] = [
  asset('robot_arm', 'Robot Arm Reality Asset'),
  asset('smart_light', 'Smart Light Reality Asset'),
  asset('camera_sensor', 'Camera Sensor Reality Asset'),
  asset('mobile_robot', 'Mobile Robot Reality Asset'),
  asset('conveyor_belt', 'Conveyor Belt Reality Asset'),
  asset('plc_cabinet', 'PLC Cabinet Reality Asset'),
  asset('lab_instrument', 'Lab Instrument Reality Asset'),
  asset('drone_unit', 'Drone Unit Reality Asset'),
  asset('warehouse_rack', 'Warehouse Rack Reality Asset'),
  asset('sensor_box', 'Sensor Box Reality Asset')
];

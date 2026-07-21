import type { DeviceType } from '../../types/deviceMeta';

/**
 * Standard device profile catalog (platform Stage 2, demand side).
 *
 * The low-barrier bet: a non-specialist enterprise should PICK a standard
 * device profile that covers a common case and get going — not author one from
 * scratch. Each entry maps a recognizable device class to a governance-green
 * reference profile plus a representative plain-language prompt.
 *
 * Honesty contract: every entry here references a real profile in profiles/
 * that passes `sdk:conformance` with its declared samplePrompt. This is checked
 * by tests/adapter-sdk/standardCatalog.test.ts — the catalog cannot list a
 * profile that would not pass platform governance.
 */
export interface StandardProfileEntry {
  /** Stable catalog id used by `sdk:scaffold --from <id>`. */
  id: string;
  title: string;
  deviceType: DeviceType;
  /** Directory name under profiles/ that backs this standard. */
  referenceProfile: string;
  /** A plain-language prompt that compiles against this profile's world model. */
  samplePrompt: string;
  useCase: string;
  tags: string[];
}

export const STANDARD_PROFILE_CATALOG: StandardProfileEntry[] = [
  {
    id: 'arm-pick-place',
    title: 'Pick-and-Place Robot Arm',
    deviceType: 'robot_arm',
    referenceProfile: 'virtual-robot-arm',
    samplePrompt: 'put the red cube in the back area',
    useCase: 'Move parts between staging and a safe drop zone.',
    tags: ['arm', 'pick-place', 'starter']
  },
  {
    id: 'arm-generic',
    title: 'Generic Industrial Arm',
    deviceType: 'robot_arm',
    referenceProfile: 'generic-robot-arm',
    samplePrompt: 'put the red cube in the right safe zone',
    useCase: 'General-purpose arm with left/right safe zones.',
    tags: ['arm', 'generic']
  },
  {
    id: 'arm-desktop',
    title: 'Desktop Pick-and-Place Arm',
    deviceType: 'robot_arm',
    referenceProfile: 'desktop-pick-place-arm',
    samplePrompt: 'put the red cube in the right safe zone',
    useCase: 'Small desktop arm for light sorting and demos.',
    tags: ['arm', 'desktop', 'compact']
  },
  {
    id: 'arm-lab-restricted',
    title: 'Restricted Lab Arm',
    deviceType: 'robot_arm',
    referenceProfile: 'restricted-lab-arm',
    samplePrompt: 'put the red cube in the right safe zone',
    useCase: 'Lab arm with extra operator and calibration zones.',
    tags: ['arm', 'lab', 'restricted']
  },
  {
    id: 'light-rgb',
    title: 'RGB Smart Light / Indicator',
    deviceType: 'smart_light',
    referenceProfile: 'virtual-smart-light',
    samplePrompt: 'set the light to blue',
    useCase: 'Status indicator or area light with color and brightness control.',
    tags: ['light', 'indicator', 'starter']
  },
  {
    id: 'light-switch',
    title: 'On/Off Smart Switch',
    deviceType: 'smart_light',
    referenceProfile: 'smart-light-switch',
    samplePrompt: 'turn on the light',
    useCase: 'Simple on/off switch — the most common IoT actuator.',
    tags: ['light', 'switch', 'on-off']
  },
  {
    id: 'light-dimmable',
    title: 'Dimmable Smart Light',
    deviceType: 'smart_light',
    referenceProfile: 'smart-light-dimmable',
    samplePrompt: 'dim the light',
    useCase: 'White light with on/off and brightness, no color.',
    tags: ['light', 'dimmable']
  },
  {
    id: 'camera-inspect',
    title: 'Inspection Camera',
    deviceType: 'camera_sensor',
    referenceProfile: 'virtual-camera-sensor',
    samplePrompt: 'take a photo',
    useCase: 'Read-only capture for inspection or presence checks.',
    tags: ['camera', 'inspection', 'read-only']
  }
];

export function listStandardProfiles(): StandardProfileEntry[] {
  return STANDARD_PROFILE_CATALOG;
}

export function getStandardProfile(id: string): StandardProfileEntry | undefined {
  return STANDARD_PROFILE_CATALOG.find((entry) => entry.id === id);
}

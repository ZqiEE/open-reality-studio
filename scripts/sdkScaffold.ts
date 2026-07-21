/**
 * sdk:scaffold — generate a new device-adapter skeleton that passes
 * `sdk:conformance` out of the box.
 *
 * WHY (platform/ecosystem): "let many enterprises self-serve" only works if a
 * non-specialist can go from zero to a governance-green adapter in minutes.
 * This scaffolds a working, simulation-only, zero-execution-authority profile
 * from a verified reference of the chosen device type, then immediately runs
 * the governance self-check so the developer sees GREEN before editing.
 *
 * SAFETY: it clones a KNOWN-GOOD reference profile (which is simulation_only /
 * read_only) and rewrites only identity fields (profile_id, device_id,
 * display_name, model, manufacturer). It never fabricates capabilities or
 * loosens governance; `realAdapterEnabled` is derived from support level and
 * stays false. The generated skeleton is a proposal template, not an
 * execution grant.
 *
 * Usage:  npm run sdk:scaffold -- --type smart_light --name my-lamp
 *         (optional: --display "My Lamp"  --vendor "Acme")
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSdkConformance, type SdkConformanceResult } from './sdkConformance';
import type { DeviceProfile } from '../types/deviceMeta';

/** Device types that yield a runnable, governance-green skeleton today. */
export const SCAFFOLDABLE_TYPES = ['robot_arm', 'smart_light', 'camera_sensor'] as const;
export type ScaffoldableType = (typeof SCAFFOLDABLE_TYPES)[number];

const REFERENCE_PROFILE: Record<ScaffoldableType, string> = {
  robot_arm: 'virtual-robot-arm',
  smart_light: 'virtual-smart-light',
  camera_sensor: 'virtual-camera-sensor'
};

export interface ScaffoldOptions {
  type: ScaffoldableType;
  /** kebab-case slug; becomes the profile directory + profile_id. */
  name: string;
  display?: string;
  vendor?: string;
  /** Repo root that contains profiles/ (default: process.cwd()). */
  repoRoot?: string;
  /** Where to write the new profile dir (default: <repoRoot>/profiles). */
  outRoot?: string;
  /** Override the reference profile to clone (e.g. a standard catalog entry). */
  referenceProfile?: string;
  /** Representative prompt used for the post-scaffold conformance check. */
  prompt?: string;
}

export interface ScaffoldResult {
  profileDir: string;
  profile: DeviceProfile;
  conformance: SdkConformanceResult;
}

function assertSlug(name: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`--name must be a kebab-case slug (a-z, 0-9, -), got "${name}"`);
  }
}

/**
 * Generate the skeleton. Returns the generated profile and its self-check
 * result. Throws on invalid input or if the target directory already exists
 * (never overwrites authored work).
 */
export function scaffoldAdapter(options: ScaffoldOptions): ScaffoldResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  const outRoot = options.outRoot ?? path.join(repoRoot, 'profiles');

  if (!SCAFFOLDABLE_TYPES.includes(options.type)) {
    throw new Error(`--type must be one of: ${SCAFFOLDABLE_TYPES.join(', ')}`);
  }
  assertSlug(options.name);

  const profileDir = path.join(outRoot, options.name);
  if (fs.existsSync(profileDir)) {
    throw new Error(`refusing to overwrite existing profile directory: ${profileDir}`);
  }

  const referenceName = options.referenceProfile ?? REFERENCE_PROFILE[options.type];
  const referenceDir = path.join(repoRoot, 'profiles', referenceName);
  const deviceMeta = JSON.parse(fs.readFileSync(path.join(referenceDir, 'device.meta.json'), 'utf8'));
  const geometry = JSON.parse(fs.readFileSync(path.join(referenceDir, 'geometry.json'), 'utf8'));

  const display = options.display ?? options.name;
  const deviceId = `${options.name}-001`;
  deviceMeta.profile_id = options.name;
  deviceMeta.device_id = deviceId;
  deviceMeta.display_name = display;
  deviceMeta.model = display;
  if (options.vendor) deviceMeta.manufacturer = options.vendor;

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'device.meta.json'), `${JSON.stringify(deviceMeta, null, 2)}\n`);
  fs.writeFileSync(path.join(profileDir, 'geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`);

  const profile: DeviceProfile = { id: deviceId, label: display, deviceMeta, geometry };
  const conformance = runSdkConformance(profile, { prompt: options.prompt });
  return { profileDir, profile, conformance };
}

function parseArgs(argv: string[]): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
      out[key] = value;
    }
  }
  return out;
}

// CLI entry:
//   node scripts/sdkScaffold.js --type smart_light --name my-lamp
//   node scripts/sdkScaffold.js --from arm-generic --name my-arm
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  // Lazy require so the raw --type path has no catalog dependency.
  const { getStandardProfile, listStandardProfiles } = require('../lib/adapter-sdk/standardCatalog');
  let scaffoldInput: ScaffoldOptions | null = null;
  if (args.from) {
    const entry = getStandardProfile(args.from);
    if (!entry) {
      process.stderr.write(`unknown standard profile "${args.from}". Available: ${listStandardProfiles().map((e: { id: string }) => e.id).join(', ')}\n`);
      process.exit(2);
    }
    if (!args.name) {
      process.stderr.write('Usage: node scripts/sdkScaffold.js --from <catalog-id> --name <slug> [--display "Name"] [--vendor "Vendor"]\n');
      process.exit(2);
    }
    scaffoldInput = {
      type: entry.deviceType,
      name: args.name,
      display: args.display,
      vendor: args.vendor,
      referenceProfile: entry.referenceProfile,
      prompt: entry.samplePrompt
    };
  } else if (args.type && args.name) {
    scaffoldInput = {
      type: args.type as ScaffoldableType,
      name: args.name,
      display: args.display,
      vendor: args.vendor
    };
  }
  if (!scaffoldInput) {
    process.stderr.write('Usage: node scripts/sdkScaffold.js (--type <robot_arm|smart_light|camera_sensor> | --from <catalog-id>) --name <slug> [--display "Name"] [--vendor "Vendor"]\n');
    process.exit(2);
  }
  try {
    const result = scaffoldAdapter(scaffoldInput);
    process.stdout.write(`Created ${path.relative(process.cwd(), result.profileDir)}/ (device.meta.json + geometry.json)\n\n`);
    for (const check of result.conformance.checks) {
      process.stdout.write(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.id}\n`);
    }
    process.stdout.write('\n');
    if (result.conformance.ok) {
      process.stdout.write('GREEN — skeleton passes governance. Next steps:\n');
      process.stdout.write(`  1. Edit ${path.relative(process.cwd(), result.profileDir)}/device.meta.json (capabilities, constraints, display) and geometry.json to match your device.\n`);
      process.stdout.write(`  2. Re-check:  npm run sdk:conformance -- ${path.relative(process.cwd(), result.profileDir)}\n`);
      process.stdout.write('  3. When green, package it as a simulation-only marketplace submission.\n');
    } else {
      process.stdout.write('Scaffold produced a non-green skeleton (unexpected). Review the FAIL items above.\n');
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`sdk:scaffold failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

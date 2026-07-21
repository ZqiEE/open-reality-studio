/**
 * sdk:catalog — list the standard device profiles a developer can start from.
 *
 * Demand-side on-ramp (platform Stage 2): instead of authoring a device from
 * scratch, pick a standard that covers a common case:
 *
 *     npm run sdk:catalog
 *     npm run sdk:scaffold -- --from <id> --name my-device
 *
 * Every listed standard is governance-green (verified by
 * tests/adapter-sdk/standardCatalog.test.ts).
 */
import { listStandardProfiles } from '../lib/adapter-sdk/standardCatalog';

if (require.main === module) {
  const entries = listStandardProfiles();
  process.stdout.write(`Standard device profiles (${entries.length}):\n\n`);
  for (const entry of entries) {
    process.stdout.write(`  ${entry.id.padEnd(18)} ${entry.title}\n`);
    process.stdout.write(`  ${''.padEnd(18)} type: ${entry.deviceType} | ${entry.useCase}\n`);
    process.stdout.write(`  ${''.padEnd(18)} start: npm run sdk:scaffold -- --from ${entry.id} --name my-${entry.deviceType.replace(/_/g, '-')}\n\n`);
  }
  process.stdout.write('Pick one, scaffold it, edit to your device, then sdk:conformance and sdk:submit.\n');
}

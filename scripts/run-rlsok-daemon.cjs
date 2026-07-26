'use strict';

const lines = [
  'RLSOK ReleaseGate daemon',
  'Release control for executable robot policies.',
  '',
  'Headless composition root: apps/daemon/index.ts',
  'No network transport or robot adapter is configured by this repository.',
  'Embed ReleaseGateDaemon with an explicit ExecutionGate and supervised transport.'
];

process.stdout.write(`${lines.join('\n')}\n`);

if (process.argv.slice(2).some((argument) => !['--help', '-h', 'help'].includes(argument))) {
  process.stderr.write('Unsupported daemon argument. This entry does not start a live ROS 2 or device connection.\n');
  process.exitCode = 1;
}

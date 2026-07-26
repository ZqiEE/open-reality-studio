'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp-ros2-reference-test');

if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
try {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '-p', 'tsconfig.json',
      '--outDir', output,
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--noEmit', 'false'
    ],
    { cwd: root, stdio: 'inherit' }
  );
  execFileSync(
    process.execPath,
    [
      path.join(output, 'tests', 'ros2-reference', 'ros2Reference.test.js'),
      ...process.argv.slice(2)
    ],
    { cwd: root, stdio: 'inherit' }
  );
} finally {
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
}

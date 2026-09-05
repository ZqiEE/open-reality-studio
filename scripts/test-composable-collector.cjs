const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', resolve(__dirname, '../experimental/composable-shadow'), '-p', 'test_*.py', '-v'], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

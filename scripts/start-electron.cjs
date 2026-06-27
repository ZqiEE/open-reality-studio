const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronEntry = path.join(root, 'dist-electron', 'main.js');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const electronBin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const hasNextProdBuild = fs.existsSync(path.join(root, '.next-build', 'BUILD_ID'));

function ensureElectronBuild() {
  if (fs.existsSync(electronEntry)) return;
  execFileSync(process.execPath, [tsc, '-p', 'electron/tsconfig.json'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
}

function runElectron(args) {
  const child = spawn(electronBin, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: false
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

ensureElectronBuild();

if (hasNextProdBuild) {
  runElectron([electronEntry, '--prod']);
} else {
  runElectron([electronEntry]);
}

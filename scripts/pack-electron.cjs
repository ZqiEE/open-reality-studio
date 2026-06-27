const { execFileSync } = require('node:child_process');

let builderCli;

try {
  require.resolve('electron-builder');
  builderCli = require.resolve('electron-builder/out/cli/cli.js');
} catch {
  console.error('electron-builder is not installed. Run npm install to fetch devDependencies before packaging the desktop installer.');
  process.exit(1);
}

execFileSync(process.execPath, [builderCli, '--win', 'nsis'], {
  stdio: 'inherit',
  windowsHide: true
});

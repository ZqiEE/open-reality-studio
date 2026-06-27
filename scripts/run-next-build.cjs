const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const cleanScript = path.join(root, 'scripts', 'clean-next-build.cjs');

function clean() {
  execFileSync(process.execPath, [cleanScript], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
}

function runBuild() {
  execFileSync(process.execPath, [nextCli, 'build'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
}

clean();

try {
  runBuild();
} catch (error) {
  console.warn('Next build failed on the first attempt. Retrying once with a clean dist directory.');
  clean();
  runBuild();
}

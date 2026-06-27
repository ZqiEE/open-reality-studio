const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const nextBuildDir = path.join(root, '.next-build');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWithPowerShell(targetPath) {
  const command = `
    $target = '${targetPath.replace(/\\/g, '\\\\')}'
    if (Test-Path $target) {
      Start-Sleep -Milliseconds 300
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
  `;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true
  });
}

function removeWithRetry(targetPath, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      removeWithPowerShell(targetPath);
      if (!fs.existsSync(targetPath)) return;
      if (attempt === attempts) throw error;
      sleep(150 * attempt);
    }
  }
}

if (fs.existsSync(nextBuildDir)) {
  removeWithRetry(nextBuildDir);
  console.log('Removed stale .next-build directory.');
} else {
  console.log('No existing .next-build directory to remove.');
}

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const rcedit = require('rcedit');

module.exports = async function applyWindowsBranding(context) {
  if (context.electronPlatformName !== 'win32') return;

  const packageJson = context.packager.info.metadata;
  const executable = path.join(context.appOutDir, 'RLSOK.exe');
  const icon = path.resolve(__dirname, '..', 'assets', 'branding', 'realitywarden.ico');
  if (!fs.existsSync(executable)) throw new Error(`Windows executable missing before branding: ${executable}`);
  if (!fs.existsSync(icon)) throw new Error(`Windows icon missing: ${icon}`);

  await rcedit(executable, {
    icon,
    'file-version': packageJson.version,
    'product-version': packageJson.version,
    'version-string': {
      CompanyName: packageJson.author,
      FileDescription: 'RLSOK ReleaseGate',
      InternalName: 'RealityWarden',
      LegalCopyright: `Copyright © ${new Date().getUTCFullYear()} ${packageJson.author}`,
      OriginalFilename: 'RLSOK.exe',
      ProductName: 'RealityWarden'
    }
  });
};

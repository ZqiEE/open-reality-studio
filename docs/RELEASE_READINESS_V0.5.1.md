# RealityWarden v0.5.1 Public Alpha Release Readiness

This report records software and packaging readiness. It does not create a tag,
push a branch, sign binaries, publish a release, or claim production readiness.

## Decision

Status: **software release candidate ready**

The v0.5.1 source, documentation, package contract, automated safety gates, and
versioned Windows installer are aligned. The packaged executable passed the
production smoke path. Physical reference-kit testing is optional field
evidence, not a development or release-engineering prerequisite.

## Readiness gates

### Product boundary — pass

- The default shell is REAL-first and disconnected REAL mode contains no
  simulation canvas, virtual device, or stale telemetry.
- Simulation Run/Stop, imports, Marketplace, and exports appear only after
  explicit entry into SIM LAB; desktop simulation shortcuts switch there first.
- Manual-derived profiles and assets remain permanently simulation-only.
- REAL HARDWARE is visually independent and limited to the reference rig.
- Evidence lock, operator confirmation, default-block interlocks, private ticket
  path, and explicit `real_hardware` audit labeling remain intact.

### Safety and product evidence — pass

- real-hardware invariant suite: **48/48**;
- virtual-loopback scenarios: **5/5**;
- manual-import malicious-input, second-gate, and explicit action-install suite: **21/21**;
- blocked commands prove zero signal with `hardwareSignalSent:false` and
  `hardwareSignalState:not_sent`;
- ambiguous sends are `attempted_unconfirmed`, never acknowledged execution;
- SG90 acknowledgement is `command_acknowledged_open_loop` with
  `physicalOutcomeVerified:false`.

### Build and package — pass

The installed application includes an offline support guide and recovery
references. The visible File menu and native Help menu expose the guide, local
About/version boundary, and a user-initiated diagnostic export. Diagnostics are
bounded, allowlisted, path/secret-redacted, local-only, and explicitly exclude
project content, prompts, audit/hardware results, serial ports, environment
variables, and credentials.

The installer also includes deterministic Markdown and offline HTML third-party
notices. They are generated from the npm production-dependency CycloneDX
inventory, bound to `package-lock.json`, include the reviewed UR5e BSD-3-Clause
and TurtleBot3 Apache-2.0 model sources, and are available from **Help →
Third-Party Notices**. Package and release tests reject stale or missing notices.

Required commands:

```powershell
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.next.json --noEmit
npx tsc -p electron/tsconfig.json --noEmit
npm run test:real-hardware
npm run test:virtual-loopback
node lib/desktop/runDesktopTests.js
node lib/conformance/runConformance.js
npm run verify
npm run desktop:pack
npm run desktop:pack:production
npm run marketplace:live:verify -- --distribution marketplace/distribution.json --out release/RealityWarden-0.5.1-Marketplace-Live-Evidence.json
npm run release:supply-chain
npm run release:prepare-public
```

`desktop:pack` must fail unless the versioned NSIS installer, app asar, unpacked
Next runtime, compiled shared safety runtime, pinned `pdfjs-dist`, manual-import
UI boundary, firmware SHA256 pairs, branding metadata, and Windows serialport
bindings are present. It must then run the packaged executable with
`--prod --smoke-test` successfully. The smoke is a packaged first-run renderer
smoke, not only a local-server readiness probe: it verifies the REAL-first
workspace with zero simulation controls/imports, the primary REAL HARDWARE
boundary, and preload bridges. Its explicit SIM LAB pass verifies the sole
Run/Stop pair, simulation-only tools, and simulation/REAL separation. Failure
exits non-zero.

The packaged executable must then pass the versioned product-design acceptance
matrix: 1440×900 and 1180×720 in Chinese and English, Windows 125% and 150%
scaling, dialog boundaries and focus restoration, trusted keyboard focus, and
forced-colors REAL HARDWARE separation. This is measured from the packaged
renderer and emitted as machine-readable evidence, not inferred from source or
static screenshots.

After the unpacked smoke, the packaging gate performs an isolated Windows
current-user lifecycle in a dedicated temporary directory: clean silent install,
installed first-run renderer smoke, a safe-executed then unsafe-blocked journey
with one-step Audit & Governor evidence, forced-offline startup with an explicit rule
compiler degradation label, deterministic in-place reinstall, and silent
uninstall. It refuses to run if any pre-existing RealityWarden uninstall
registration is present, so release verification cannot overwrite a user's
installation. Reinstall and uninstall must preserve user project/profile data;
the installed application payload and uninstall registration must be removed.

Expected artifact:

```text
release/RealityWarden-0.5.1-Setup.exe
release/RealityWarden-0.5.1-Startup-Acceptance.json
release/RealityWarden-0.5.1-Startup-Acceptance.json.sha256
release/RealityWarden-0.5.1-Design-Acceptance.json
release/RealityWarden-0.5.1-Design-Acceptance.json.sha256
release/RealityWarden-0.5.1-Install-Lifecycle.json
release/RealityWarden-0.5.1-Install-Lifecycle.json.sha256
release/RealityWarden-0.5.1-Release-Evidence.json
release/RealityWarden-0.5.1-Release-Evidence.json.sha256
# production mode only:
release/RealityWarden-0.5.1-Authenticode-Evidence.json
release/RealityWarden-0.5.1-Authenticode-Evidence.json.sha256
release/RealityWarden-0.5.1-Marketplace-Live-Evidence.json
release/RealityWarden-0.5.1-Marketplace-Live-Evidence.json.sha256
release/RealityWarden-0.5.1-SBOM.cdx.json
release/RealityWarden-0.5.1-SBOM.cdx.json.sha256
release/RealityWarden-0.5.1-Supply-Chain-Evidence.json
release/RealityWarden-0.5.1-Supply-Chain-Evidence.json.sha256
release/RealityWarden-0.5.1-Setup.exe.sha256
release/RealityWarden-0.5.1-EULA.txt
release/RealityWarden-0.5.1-EULA.txt.sha256
release/RealityWarden-0.5.1-Privacy-Notice.txt
release/RealityWarden-0.5.1-Privacy-Notice.txt.sha256
release/RealityWarden-0.5.1-Public-Release-Manifest.json
release/RealityWarden-0.5.1-Public-Release-Manifest.json.sha256
```

The schema-v6 release evidence manifest is emitted only after package
verification, first-run renderer smoke, packaged startup/product-design
acceptance, and the Windows install lifecycle succeed. It records the exact
installer SHA256 and size, packaged Next BUILD_ID, startup/design/lifecycle
manifest digests, source commit, and clean/dirty worktree state. Companion
checksums protect all evidence records. Production mode additionally requires
checksummed Authenticode evidence proving both the packaged executable and NSIS
installer are `Valid` and timestamped, bound to their exact SHA256 digests.
It also requires the strict owner-controlled legal input manifest for this
version and binds its publisher identity, sales jurisdictions, approval
metadata, EULA, and privacy-notice digests. The approved EULA is supplied to
NSIS. Internal packaging marks legal inputs `not_assessed` rather than implying
owner or counsel approval.
Historical internal-pack evidence deliberately marks code signing, migration
from a different historical version, and optional physical-hardware acceptance
as not assessed rather than inventing evidence. A publishable build must use
`desktop:pack:production`, which additionally refuses to start unless the
release has a production-valid Official signed-catalog configuration, a Windows
code-signing certificate input, and current owner-approved legal inputs.

`release:prepare-public` is the final handoff gate before creating a tag or
uploading files. It refuses internal-acceptance evidence, dirty or divergent
source revisions, installer digest changes, an unpassed release gate, invalid
or inconsistent Authenticode identities, stale/expired/wrong-key Marketplace
live evidence, stale/vulnerable/lockfile-divergent supply-chain evidence,
changed/missing/placeholder legal inputs, missing companion checksums, and
existing outputs. `release:supply-chain` is an
explicit online release action: npm audit must complete with zero known records;
there is no offline pass or cached fallback. It emits a package-lock-bound
CycloneDX production-dependency SBOM and checksummed evidence. Success of the
final gate emits an exclusive installer checksum, versioned EULA and privacy
notice with companion checksums, and a checksummed public-release manifest
listing the exact upload set. It performs no tag, push, or upload itself.

Last fully verified local artifact record (v0.5.0, 2026-07-15; retained as historical evidence, not claimed for v0.5.1):

- size: `186503174` bytes (`177.86 MiB`);
- SHA256: `B7B826906E3F78A4F1232870E540CDD69CE8C89CA210D8730506F4C0EDD78C3C`;
- clean source commit: `18a40f00da8695bb8c2ea971bc1074172f41e23b`;
- executable FileVersion/ProductVersion: `0.5.0`;
- package verification: pass (shared runtime, Next runtime, manual/PDF import
  boundary, pinned pdfjs runtime, three serialport native bindings, firmware
  image + SHA256, and branding);
- packaged `RealityWarden.exe --prod --smoke-test`: pass.
- packaged product-design matrix: pass (1440×900 / 1180×720,
  Chinese/English, 125%/150% scale, dialogs, focus, and forced colors).
- packaged startup-design matrix: pass (neutral dark first paint,
  Chinese/English, 125%/150% scale, escaped recovery details, reduced motion,
  and forced colors).
- isolated Windows lifecycle schema v2: pass (clean install, installed
  safe/blocked/audit core journey, forced-offline degradation, in-place
  reinstall, uninstall cleanup, and user data preservation).

## Manual release actions outside this report

- owner-controlled Official Marketplace public key/catalog provisioning;
- hosting followed by the no-redirect, no-retry live catalog/package evidence check;
- owner-controlled Windows certificate issuance and signing identity;
- owner-approved product EULA/privacy terms, publisher legal identity, and legal
  review for the target sales jurisdictions, supplied through
  `release-inputs/legal/` (third-party notices do not license RealityWarden
  itself; the software gate cannot judge legal adequacy);
- manual tag and GitHub release creation;
- upload of exactly the files listed by the generated public-release manifest;
- optional refreshed demo or physical reference-kit evidence.

None of these may weaken the automated safety gates or alter the truthful Public
Alpha boundary.

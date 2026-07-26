# Migration from the legacy desktop product

Migration is additive and reversible:

1. Build RobotProfile, controller profile, and ActionContract artifacts.
2. Convert existing Action Manifests through
   `LegacyActionManifestAdapter`; converted content remains untrusted.
3. Convert retained device metadata through `LegacyDeviceManifestAdapter`.
4. Build and check an ExecSpec.
5. Exercise the release in shadow mode and verify evidence.
6. Move through canary/released only after explicit approval.
7. Keep the ESP32 safety path as a reference adapter while generic contracts
   stabilize.

No legacy production source was deleted in the first round. Desktop/Lab may
depend on Core; Core must not depend on React, Next.js, Electron, 3D UI,
Marketplace, Manual Import, or the LLM compiler.

The pre-refactor desktop baseline is recoverable at Git tag
`legacy-desktop-v0.5`.

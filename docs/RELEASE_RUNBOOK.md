# Runtime release runbook

RLSOK publishes a runtime only after the matching Cloud compatibility record is
live. Repository immutable releases must be enabled before release preparation;
the workflow checks the repository API and stops when enforcement is absent.

`v1.4.4` is a historical pre-enforcement release. Do not delete, edit, recreate,
or relabel it. GitHub enforcement applies to releases published after the
repository setting was enabled.

## Required order

1. Merge and deploy the Cloud change whose live `release.json` names the exact
   runtime tag and source commit. Its `minimumCloudSourceCommit` must be an
   ancestor of the source returned by both authenticated `/readyz` and public
   `/deployment.json`.
2. Prove `/healthz`, authenticated `/readyz`, and `shadow-only` in production.
3. Merge the runtime candidate and wait for the exact main CI distribution.
4. Dispatch `Publish verified release` with the tag, CI run ID, and exact source
   SHA. Use the protected `production-release` environment and its dedicated
   read-only Cloud readiness credential.
5. The workflow creates one clean draft, refuses mismatched or old Cloud,
   downloads the exact CI artifact, verifies the complete asset set and every
   digest, uploads without replacement, and publishes once.
6. Publication is complete only when the release API reports `immutable: true`,
   `gh release verify` succeeds, and `gh release verify-asset` succeeds for every
   uploaded file.

Never put the readiness credential in an artifact, command argument, release
body, or debug log. A failed gate may leave an empty draft; investigate the root
cause and do not replace or clobber assets to force publication.

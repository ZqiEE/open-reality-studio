# ExecutablePolicySpec (ExecSpec)

`apiVersion: realitywarden.io/v1alpha1`, `kind: ExecutablePolicy`.

An ExecSpec identifies the complete executable release, not only a model
checkpoint. Its strict Zod schema is in `packages/exec-spec`. Unknown fields,
missing hashes, absolute artifact paths, invalid timestamps, non-fail-closed
runtime policy, and inconsistent joint dimensions are invalid.

Identity-bearing inputs include:

- model artifact, framework, policy type, and code revision;
- ActionContract representation, dimension, joint order, units, and
  normalizer/pre/postprocessor hashes;
- RobotProfile, URDF, controller type, and controller configuration hashes;
- runtime policy and state freshness limits;
- scenario/test evidence, approval identity, allowed devices, mode, and expiry.

`rw build` does not guess these values. The model directory must include
`model.json` with `framework`, `policyType`, and `codeRevision`. Robot and
ActionContract files use their package schemas. The controller profile must
declare `controllerType` and `compatibleRepresentations`. The runtime-policy
file explicitly supplies metadata, artifact component hashes, runtime limits,
evidence, and deployment fields.

`rw check` returns `PASS`, `BLOCK`, `APPROVAL_REQUIRED`, or `INVALID`.
`rw diff` identifies identity-bearing changes and reports whether prior
approval is invalidated.

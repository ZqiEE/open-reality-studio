# CLI

The only public command is `rlsok`. In this repository use
`npm run rlsok -- <arguments>`.

## Release commands

```text
rlsok build --model <file-or-dir>
            --robot-profile <file>
            --controller-profile <file>
            --action-contract <file>
            --runtime-policy <file>
            --output <file>

rlsok check <execspec>
rlsok diff <previous-execspec> <next-execspec>
rlsok verify-evidence <bundle-or-directory>
```

`build` hashes the exact supplied artifacts. `check` exits nonzero for blocked
or invalid releases. `diff` reports whether content changes invalidate
approval. `verify-evidence` checks bundle identity and every chain link.

## ROS 2 commands

```text
rlsok ros2 [shadow] --release <execspec> --device <id>
                    --proposer <identity> [--evidence <path>]

rlsok ros2 run --release <execspec> --device <id>
               --proposer <identity>
               --allow-reference-run <exact-release-id>
               [--evidence <path>]

rlsok ros2 doctor [--python <path>] [--sidecar <path>]
rlsok ros2 inspect [--python <path>] [--sidecar <path>]
```

Shadow is the default. Run also requires SROS2 `Enforce` and an available
`FollowJointTrajectory` action server before proposal subscription starts.

Exit code `0` means the command completed successfully. Invalid input,
ineligible releases, unavailable ROS dependencies, failed evidence
verification, and unsafe reference preconditions exit nonzero.

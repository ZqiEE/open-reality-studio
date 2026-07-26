# Design-partner validation

The goal is integration evidence, not production or safety acceptance.

## Entry criteria

- isolated ROS 2 Jazzy domain;
- simulator or supervised low-energy cell;
- independent E-stop/protective stop;
- stable joint order and trajectory controller;
- synchronized clocks;
- SROS2 `Enforce`;
- reviewed Shadow ExecSpec with exact device/proposer binding.

## Evaluation

1. Record `ros2 doctor` and `ros2 inspect`.
2. Run `npm run verify`.
3. Process at least 100 Shadow proposals and prove zero controller goals.
4. Test malformed payload, wrong release/device/proposer, duplicate ID,
   missing/stale state, joint mismatch, changed content, expiry, and revocation.
5. Verify the evidence bundle independently.
6. If separately authorized, run one constrained canary goal.
7. Revoke during an active goal and compare RLSOK evidence, controller logs,
   and physical observation.

Use `design-partner/ros2-reference/EVALUATION_CHECKLIST.md`.

## Exit criteria

No unexplained actuation, zero Shadow goals, complete evidence, enforced graph
permissions, and a written disposition for every failure. Passing means the
reference architecture may proceed to further engineering; it does not
authorize unattended or production operation.

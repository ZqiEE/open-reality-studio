# First Low-Risk Real Device Plan

This document is a plan only.

It does **not** enable real device execution.
It does **not** add real adapter code.
It does **not** turn `realAdapterEnabled` on.

Current boundary remains:

- simulation-first
- no real device execution
- no production hardware control
- no certified industrial safety guarantee

## Decision

The first low-risk real device candidate should be:

**local webcam read-only**

This is the safest first real-device path because it validates the runtime-to-adapter boundary without introducing physical actuation.

## Why this is the lowest-risk choice

Compared with the other candidates:

- `smart light`
- `ESP32 LED`
- `Home Assistant light`
- `local webcam read-only`

the webcam path has the smallest blast radius.

Reasons:

1. it is read-only
2. it does not move a physical mechanism
3. it does not toggle real-world lighting state
4. failure is easier to contain
5. rollback is simpler because there is no physical state to undo
6. it proves the real adapter boundary with less safety exposure

## Candidate comparison

### 1. local webcam read-only

Risk level: **lowest**

Pros:

- no actuation
- natural fit for `camera_sensor`
- easy to reason about as a real adapter in `read_only` mode
- proves the runtime can talk to a real edge source without commanding hardware

Cons:

- weaker commercial signal than actuation
- does not yet validate real-world command execution

### 2. smart light

Risk level: **low**

Pros:

- bounded physical actuation
- easy user-visible result
- already has a simulation path in the current product

Cons:

- is still actuation
- requires a clearer rollback and off-state guarantee
- still needs stronger human confirmation rules than a read-only camera

### 3. ESP32 LED

Risk level: **low to medium**

Pros:

- simple hardware
- bounded command set

Cons:

- hardware setup friction
- transport and device state reliability become part of the test
- still actuation

### 4. Home Assistant light

Risk level: **low to medium**

Pros:

- realistic integration story
- useful commercial demo path

Cons:

- depends on external local platform state
- state sync and authorization are more complex
- risk of implying broader home automation support too early

## Proposed first real-device scope

Start with:

- `camera_sensor`
- mode: `read_only`
- target: local webcam

Allowed operations in the first iteration:

- enumerate camera source
- capture current frame
- read camera status

Not allowed:

- PTZ
- writing settings to hardware
- cloud relay
- background automation
- multi-device orchestration

## Adapter needs

The future adapter would need:

1. adapter id for the webcam source
2. target device id mapping to `camera_sensor`
3. explicit mode: `read_only`
4. `compileTaskDslToAdapterPlan()`
5. `validateAdapterPlan()`
6. `dryRun()`
7. local state feedback
8. local audit log events

The adapter plan should remain narrower than general product intent:

- `capture_frame`
- `read_sensor`

Anything outside that scope should return `unsupported`.

## Safety boundary

The first real-device path must preserve these rules:

1. Runtime Kernel still runs first
2. unsupported / ambiguous / blocked must stop before adapter dispatch
3. real adapter mode must stay `read_only`
4. no cloud dependency in the execution path
5. local logs must record prompt, goal, decision, adapter request, and result
6. dry-run must exist before any real source interaction is trusted

For the webcam path specifically:

- actuation is forbidden
- state mutation is forbidden
- adapter permissions are read-only

## Rollback / emergency stop

For the webcam path:

- rollback is mostly “stop capture / release device handle”
- emergency stop means:
  1. cancel active capture request
  2. release local device session
  3. mark adapter state as stopped

This is much simpler than a physical actuator because there is no mechanical motion to unwind.

## Human confirmation

For the first webcam path:

- normal frame capture should not require human confirmation
- repeated or high-frequency capture policies can still be gated later if needed

For the first actuation path after that, such as `smart_light`:

- human confirmation should likely remain required for mode changes outside a narrow allowlist until the adapter proves reliable

## When `realAdapterEnabled` can become true

Not now.

It should only become `true` for the first device after all of the following are true:

1. adapter contract exists
2. dry-run path exists
3. local safety boundary is explicit
4. adapter validation rejects unsupported plans
5. audit logging is complete
6. stop / release behavior is verified
7. user-facing product copy still clearly says what is real and what is simulation

For the first real path, the safest interpretation is:

- `realAdapterEnabled` may become true **only for `camera_sensor` read-only webcam mode**
- all actuation families remain false

## Recommended next order

1. first real path: `local webcam read-only`
2. first low-risk actuation candidate after that: `smart_light`
3. then evaluate whether a bounded `ESP32 LED` path is worth it
4. defer `Home Assistant light` until local runtime / authorization / state sync are clearer

## What this plan does not claim

This plan does not claim:

- real hardware is supported now
- webcam adapter is already implemented
- smart light should be enabled immediately
- the runtime is production-ready

It only defines the safest next step for eventually testing a real-device boundary.

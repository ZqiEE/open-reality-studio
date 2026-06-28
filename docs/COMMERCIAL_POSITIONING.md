# Commercial Positioning

Open Reality Studio is a simulation-first desktop runtime for Physical AI workflows.

It is not a generic website, not a cloud dashboard, and not only a robot arm demo. The product thesis is that AI systems should not jump directly from natural language into real hardware execution. They need a local runtime that can understand intent, check device capability, ground the task against world state, apply safety policy, simulate the outcome, and record an audit trail before any real adapter is allowed.

Current product boundary:

- simulation-only
- no real device execution
- no production hardware control
- no certified industrial safety guarantee
- current runnable paths are limited to `robot_arm`, `smart_light`, and `camera_sensor`

## Target customers

Early customer candidates:

1. robotics software teams building AI-assisted task layers above device control
2. industrial automation teams evaluating AI before touching PLCs, conveyors, or physical manipulators
3. edge AI / embodied AI startups that need a controlled desktop runtime before field deployment
4. systems integrators exploring simulation-first workflows for customer demos, presales, and validation
5. advanced labs or applied research teams that need auditable prompt-to-runtime behavior

The best first customers are not broad consumers. They are technical teams with real hardware downstream risk and a clear need for runtime explainability.

## Pain points

The product is aimed at teams facing these problems:

1. natural-language intent is not the same thing as runnable device control
2. unsupported tasks are often hidden behind brittle fallback behavior
3. teams lack a unified place to inspect:
   - what the AI understood
   - what capability was required
   - why execution was allowed or blocked
4. hardware-facing testing is expensive, slow, risky, and hard to replay
5. device support is fragmented across custom scripts, simulator demos, and adapter glue
6. customers and operators need an audit trail, not only a visual demo

## Why simulation-first runtime matters

Simulation-first is not a cosmetic choice. It is the product boundary that makes the runtime trustworthy enough to evaluate.

The value is:

1. the same runtime kernel can reason about multiple device families
2. unsupported or risky tasks can stop before adapter dispatch
3. world state, capability requirements, and safety decisions become visible artifacts
4. customers can evaluate workflow logic without needing hardware on day one
5. future real-device adapters can be attached to a clearer boundary instead of bypassing the runtime

## Why this is not just a robot arm demo

The current Public Alpha uses `robot_arm` as the strongest visible path, but the product claim is wider than robotic motion:

1. the runtime kernel already models device manifests, capability contracts, world model assumptions, planning, safety gating, TaskDSL, and adapter boundaries
2. `smart_light` and `camera_sensor` prove that the runtime is not limited to manipulation devices
3. Coming Soon device families are intentionally kept non-runnable rather than falsely presented as supported
4. the core commercial angle is runtime governance for Physical AI, not only 3D animation

## What the current alpha can do

Today the alpha can:

1. accept natural-language input in the desktop runtime
2. compile supported tasks into a simulation-only execution path
3. show runtime decisions and blocked reasons before execution
4. simulate limited runnable devices:
   - `robot_arm`
   - `smart_light`
   - `camera_sensor`
5. generate TaskDSL, adapter commands, playback feedback, and lab reports
6. keep unsupported / ambiguous / blocked cases visible instead of silently falling back

## What the current alpha cannot do

Today the alpha cannot:

1. execute real hardware
2. claim production deployment readiness
3. support all device families shown in the asset library
4. provide certified industrial safety
5. replace a full robotics simulator, PLC engineering suite, or hardware control stack
6. guarantee that natural language works for arbitrary devices or arbitrary prompts

## Monetization path

Do not position monetization as generic AI SaaS. The likely path is narrower and more defensible.

Potential path:

1. simulation-first runtime seats for technical teams
2. paid pilot for customer-specific device onboarding and workflow validation
3. adapter SDK / device onboarding support for integrators and internal platform teams
4. enterprise audit / governance features once the runtime boundary proves useful

The monetization wedge is not “chat with your robot.” It is reducing the cost and risk of moving from intent to controlled device execution.

## Honest current positioning

The right current statement is:

Open Reality Studio is an early simulation-first Physical AI desktop runtime prototype for understanding, validating, and auditing device workflows before real hardware execution.

The wrong current statement would be:

- production-ready industrial control platform
- real hardware execution product
- certified safety runtime
- universal multi-device AI operating system

Those claims are not true yet and should not be used in customer conversations.

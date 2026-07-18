# Commercial Positioning

RealityWarden is a local safety-governance runtime for Physical AI: the audited
boundary between natural-language or human intent and real hardware.

It is not a generic website, a cloud dashboard, a robot-arm animation, or a
promise that arbitrary equipment is AI-ready. Its commercial value is making
the path from intent to physical action inspectable, bounded, and reusable
without allowing a model, imported manual, Marketplace package, or operator
input to grant itself execution authority.

Current Public Alpha boundary:

- REAL-device-first desktop shell
- one governed ESP32-S3 + SG90 + HC-SR04 reference path
- explicit SIM LAB for zero-signal review and testing
- no arbitrary/customer hardware execution
- no production deployment or certified industrial-safety claim

## Target customers

The strongest early customers are technical teams that already have hardware
downstream risk:

1. robotics and embodied-AI teams adding natural-language task layers
2. systems integrators onboarding customer devices and reusable actions
3. industrial automation teams evaluating governed AI assistance
4. edge-AI startups that need local execution and audit boundaries
5. applied labs that need reproducible allow/block evidence

The initial buyer is not a broad consumer. It is the person responsible for
proving why a physical command was allowed, blocked, or never sent.

## Pain points

1. Natural-language intent is not runnable device control.
2. Device integrations are fragmented across scripts, serial tools, and opaque
   adapter glue.
3. Missing/stale sensor evidence and partial failures are often hidden.
4. Teams cannot reliably show what the model proposed, what rules recomputed,
   and whether a signal actually reached the wire.
5. Onboarding firmware, profiles, actions, and manuals requires specialist
   tooling that ordinary operators do not have.
6. Simulation demos are frequently mistaken for physical proof.

## Product wedge

The first credible wedge is a governed reference-device workflow that a maker
can use without an IDE:

1. diagnose and flash an approved prebuilt firmware image
2. connect the reviewed reference rig
3. issue deterministic natural-language or jog-teach commands
4. block on unsafe distance, missing evidence, or out-of-range proposals
5. preserve an honest per-decision audit

SIM LAB supports that business by reviewing declarative assets, reproducing
policy outcomes, and developing protocols without hardware. It is valuable,
but it is not the headline product and it never substitutes for physical
acceptance.

## Why this is not just a servo demo

The reference servo is the smallest affordable proof that the governance
architecture reaches reality. The extensible product assets are the strict
device profile, Action Manifest, ticketed execution gate, sensor-generation
model, transport contract, audit vocabulary, firmware onboarding, and
malicious-input tests. New devices must reuse and tighten those boundaries;
they may not add a bypass.

## What the current alpha can do

1. diagnose, connect, command, jog-teach, replay, and govern the documented
   reference rig
2. flash only reviewed digest-paired firmware inputs and verify after reconnect
3. stop multi-step hardware actions after the first blocked primitive
4. show current distance and honest open-loop last-command feedback
5. run separate virtual workflows for supported SIM LAB device profiles
6. review declarative manual and Marketplace proposals without granting real
   authority

## What the current alpha cannot do

1. execute arbitrary or customer hardware
2. claim a measured servo position from an open-loop command acknowledgement
3. claim production deployment readiness or certified industrial safety
4. support every device family shown in the asset library
5. replace a robotics simulator, PLC engineering suite, or device controller
6. guarantee arbitrary natural-language understanding

## Monetization path

1. paid reference-kit onboarding and governed workflow pilots
2. customer-specific declarative device/profile/action onboarding
3. adapter SDK and verification support for integrators
4. enterprise policy, audit, evidence-retention, and deployment governance
5. curated declarative asset distribution after trust operations mature

The defensible wedge is not “chat with your robot.” It is reducing the cost and
risk of proving that intent became—or did not become—a physical signal through
one inspectable control boundary.

## Honest current positioning

Use this statement:

> RealityWarden is a REAL-first Physical AI safety runtime in Public Alpha. It
> governs one documented reference rig today and includes a visibly separate
> zero-signal Simulation Lab for asset review and reproducible testing.

Do not claim production readiness, certified safety, arbitrary hardware
support, or a universal multi-device operating system.

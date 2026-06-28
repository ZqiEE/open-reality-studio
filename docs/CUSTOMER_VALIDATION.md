# Customer Validation

This document is for customer discovery and paid pilot validation. It is not a fundraising pitch and not a claim that the product is production-ready.

Current product boundary:

- simulation-only
- no real device execution
- early prototype
- current runnable paths:
  - `robot_arm`
  - `smart_light`
  - `camera_sensor`

The purpose of validation is to test whether the runtime boundary is valuable enough for real teams to keep evaluating, pilot, and eventually pay for.

## Target customer types

Start with technical teams that already feel the cost of unsafe or opaque AI-to-device workflows.

Priority customer types:

1. robotics platform teams
2. industrial automation software teams
3. embodied AI startups
4. systems integrators with customer-specific device stacks
5. applied research teams moving from simulation toward controlled deployment

Avoid broad non-technical audiences at this stage. The product is still too early and too technical.

## Validation objectives

Each conversation should test whether the prospect actually cares about:

1. seeing what the runtime understood from natural language
2. blocking unsupported or unsafe execution before adapter dispatch
3. having a simulation-first path before real hardware integration
4. producing an audit trail for why a task executed or was rejected
5. onboarding new device families through a clear runtime contract

## 10 interview questions

Use these in real conversations:

1. How do you currently move from a task request to device execution?
2. Where does your team most often lose confidence in that flow?
3. What happens today when a request is unsupported, ambiguous, or risky?
4. How much work does it take to validate a new workflow before touching hardware?
5. Which device families matter first for your team?
6. Who needs to understand why a task was allowed or blocked?
7. Would a simulation-first runtime save engineering time, operator time, or hardware risk for you?
8. What evidence would you need before trusting a runtime layer in front of real adapters?
9. If we onboarded one device family for you, which one should it be and why?
10. What would have to be true for you to run a paid pilot?

## What to show in a validation call

Keep the walkthrough honest and narrow:

1. show the AI command input
2. show a safe `robot_arm` path
3. show a blocked unsafe path
4. show that only some devices are runnable today
5. show the runtime decision and lab report
6. state clearly that real hardware is not enabled yet

Do not demo Coming Soon devices as if they are supported.

## Validation scoring rubric

Track each conversation against these signals:

- clear pain acknowledged
- current workaround exists and is costly
- interest in simulation-first validation
- interest in runtime explainability / audit
- willingness to continue conversation
- willingness to share device requirements
- willingness to test a pilot scope
- willingness to pay for a pilot

## Paid validation standard

Minimum validation bar:

1. 10 real customer interviews
2. at least 2 prospects willing to continue the conversation
3. at least 1 prospect willing to explore a pilot

Ideal validation bar:

1. at least 1 paid pilot

That is the real signal. Everything before that is still evidence gathering.

## What a paid pilot should look like

A realistic first paid pilot would likely include:

1. one customer device family
2. simulation-first runtime setup
3. device manifest and capability mapping
4. safety / blocked / unsupported behavior validation
5. lab report / audit export review

It should not promise:

- production deployment
- real hardware control in the first engagement
- broad device support
- certified industrial safety

## What to listen for

Positive signs:

1. “We already have this exact problem.”
2. “We need a safer layer before hardware.”
3. “We need to explain why the AI did or did not execute.”
4. “We would test this with one device family.”

Weak signs:

1. curiosity without operational pain
2. interest only in 3D visuals
3. requests for broad unsupported hardware claims
4. desire for generic chatbot features without runtime value

## Exit criteria for this phase

This phase is successful when:

1. the customer problem statement is sharper than it is now
2. the first viable customer segment is clearer
3. at least one device-family pilot hypothesis is concrete
4. there is evidence that some teams would keep engaging

If those signals do not appear, the right move is to narrow positioning further, not to inflate product claims.

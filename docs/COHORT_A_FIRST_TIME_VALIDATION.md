# Cohort A: uncoached first-time ROS comprehension check

This form is for one ROS engineer who has never discussed RLSOK, received an
RLSOK message, or seen an explanation from its author. Prior respondents belong
to Cohort B and cannot satisfy this check.

Please work alone, do not ask the author for coaching, and record every place
where you need help. Shadow sends no controller command, stop, hold, or zero.
Do not use a physical robot.

## Participant record

- Name or stable public handle:
- ROS experience (one sentence):
- Confirmation: “Before today I had never discussed or been contacted about
  RLSOK” (yes/no):
- Start and finish time, including timezone:
- Clean OS/container and ROS/Python/Node versions:

## Uncoached comprehension

Read <https://rlsok.com/> and the repository README, then answer without copying
their wording:

1. In one sentence, what does RLSOK do?
2. Put these in order: CI/CD, deployment, RLSOK, ROS controller.
3. Does Shadow send a controller command, stop command, hold command, or zero?
4. How is RLSOK different from SROS2?
5. Does RLSOK provide functional safety, E-stop, collision avoidance, or motion
   planning?

## Clean Zero-to-Shadow

Follow the public install path at <https://rlsok.com/download>, confirm
`rlsok --version` reports runtime `1.4.4`, run `rlsok setup`, and complete the
documented Zero-to-Shadow flow. Do not enable reference Run.

Record:

- exact commands used;
- whether setup completed;
- whether Shadow completed;
- `publicationCount`/controller goals attempted and `hardwareSignalSent`;
- total elapsed minutes;
- every page, prompt, term, or error for which help was needed;
- the first point at which you could accurately explain the product boundary.

Attach sanitized terminal output or a public gist if convenient. Remove tokens,
emails, hostnames, and other credentials. A pass requires a real completed human
record; silence or an automated run is not validation.

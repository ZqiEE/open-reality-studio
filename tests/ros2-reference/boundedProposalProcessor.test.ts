import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedProposalProcessor,
  parseProposalIdentity,
  proposalTimeoutMs,
  waitForFirstProposal,
  waitForOneShotProposal,
} from "../../apps/cli/ros2";

test("malformed proposal input has one stable fail-closed reason", () => {
  for (const payload of ["{", "null", "{}", '{"deviceId":"only"}']) {
    assert.throws(() => parseProposalIdentity(payload), /proposal_invalid/);
  }
  assert.throws(
    () => parseProposalIdentity("x".repeat(65_537)),
    /proposal_invalid/,
  );
});

test("one-shot proposal timeout is bounded and validates every configured source", async () => {
  assert.equal(proposalTimeoutMs({}), 30_000);
  assert.equal(
    proposalTimeoutMs({}, { RLSOK_ROS2_PROPOSAL_TIMEOUT_MS: "45000" }),
    45_000,
  );
  assert.equal(
    proposalTimeoutMs(
      { "proposal-timeout-ms": "1200" },
      { RLSOK_ROS2_PROPOSAL_TIMEOUT_MS: "45000" },
    ),
    1_200,
  );
  for (const value of ["999", "600001", "1.5", "NaN", "Infinity"]) {
    assert.throws(
      () => proposalTimeoutMs({ "proposal-timeout-ms": value }, {}),
      /proposal timeout must be an integer from 1000 to 600000 ms/,
    );
  }

  await assert.rejects(
    waitForFirstProposal(new Promise<void>(() => undefined), 5),
    /proposal_timeout/,
  );
  await waitForFirstProposal(Promise.resolve(), 60_000);

  let finishEvaluation: () => void = () => undefined;
  const evaluation = new Promise<void>((resolve) => {
    finishEvaluation = resolve;
  });
  const waiting = waitForOneShotProposal(Promise.resolve(), evaluation, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  finishEvaluation();
  await waiting;
});

test("bounded proposal processor evaluates later proposals without an unbounded queue", async () => {
  const handled: string[] = [];
  const errors: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const processor = new BoundedProposalProcessor(
    async (payload) => {
      handled.push(payload);
      if (payload === "first") {
        firstStarted?.();
        await firstBlocked;
      }
    },
    (error) => errors.push(error.message),
    () => errors.push("overflow"),
  );

  const first = processor.submit("first");
  await started;
  assert.equal(await processor.submit("second"), "queued");
  assert.equal(await processor.submit("third"), "rejected");
  releaseFirst?.();
  assert.equal(await first, "processed");
  assert.deepEqual(handled, ["first", "second"]);
  assert.deepEqual(errors, ["overflow"]);

  assert.equal(await processor.submit("fourth"), "processed");
  assert.deepEqual(handled, ["first", "second", "fourth"]);
  assert.equal(await processor.submit("x".repeat(65_537)), "rejected");
  assert.deepEqual(errors, ["overflow", "proposal_payload_too_large"]);
  assert.deepEqual(handled, ["first", "second", "fourth"]);
});

test("bounded proposal processor reports one failure and continues with its queued proposal", async () => {
  const handled: string[] = [];
  const errors: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const processor = new BoundedProposalProcessor(
    async (payload) => {
      handled.push(payload);
      if (payload === "bad") {
        firstStarted?.();
        await firstBlocked;
        throw new Error("malformed_proposal");
      }
    },
    (error) => errors.push(error.message),
    () => errors.push("overflow"),
  );

  const first = processor.submit("bad");
  await started;
  assert.equal(await processor.submit("next"), "queued");
  releaseFirst?.();
  await first;
  assert.deepEqual(handled, ["bad", "next"]);
  assert.deepEqual(errors, ["malformed_proposal"]);
});

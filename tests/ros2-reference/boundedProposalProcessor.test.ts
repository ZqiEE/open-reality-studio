import assert from "node:assert/strict";
import test from "node:test";
import { BoundedProposalProcessor } from "../../apps/cli/ros2";

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

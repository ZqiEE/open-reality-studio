"use strict";

// Test-only JSONL protocol fixture. It deliberately has no ROS/DDS or hardware
// implementation and rejects any dispatch attempt.

const readline = require("node:readline");
const { sharedNowMs } = require("./sharedMonotonicClock.cjs");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const proposalTopic = option("--proposal-topic", "/rlsok/action_proposals");
const jointStateTopic = option("--joint-state-topic", "/joint_states");
const controllerAction = option(
  "--controller-action",
  "/joint_trajectory_controller/follow_joint_trajectory",
);
const jointOrder = JSON.parse(option("--joint-order-json", '["joint_a","joint_b"]'));
const observationOffsetMs = Number(process.env.RLSOK_TEST_OBSERVATION_OFFSET_MS ?? "0");
if (!Number.isSafeInteger(observationOffsetMs)) {
  throw new Error("RLSOK_TEST_OBSERVATION_OFFSET_MS must be a safe integer");
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function reply(message, result) {
  send({ id: message.id, ok: true, result });
}

function jointStateEvent() {
  return {
    event: "joint_state",
    state: {
      names: jointOrder,
      positions: jointOrder.map(() => 0),
      observedAt: new Date(sharedNowMs() + observationOffsetMs).toISOString(),
    },
  };
}

const publisher = setInterval(() => send(jointStateEvent()), 100);
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  switch (message.operation) {
    case "ping":
      reply(message, { pong: true });
      break;
    case "doctor":
      send(jointStateEvent());
      reply(message, {
        rosAvailable: true,
        rosDistro: process.env.ROS_DISTRO ?? null,
        rmwImplementation: process.env.RMW_IMPLEMENTATION ?? null,
        rosDomainId: "isolated-test-clock",
        proposalTopic,
        jointStateTopic,
        controllerAction,
        jointStateFresh: true,
        actionServerAvailable: true,
        sros2Enabled: false,
        limitations: ["test-only shared monotonic clock", "not DDS", "not physical motion"],
      });
      break;
    case "dispatch":
      send({
        id: message.id,
        ok: false,
        error: "test_clock_fixture_hardware_dispatch_forbidden",
      });
      break;
    case "shutdown":
      clearInterval(publisher);
      reply(message, { closed: true });
      input.close();
      break;
    default:
      send({ id: message.id, ok: false, error: "unsupported_operation" });
  }
});

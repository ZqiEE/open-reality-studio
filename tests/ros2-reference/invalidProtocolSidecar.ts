import { createInterface } from "node:readline";

const primitiveDoctorReply = process.argv.includes("/primitive-doctor-reply");
const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const request = JSON.parse(line) as { id?: unknown; operation?: unknown };
  if (typeof request.id !== "number") return;
  if (request.operation === "ping") {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, ok: true, result: {} })}\n`,
    );
    return;
  }
  if (request.operation !== "doctor") return;
  if (primitiveDoctorReply) {
    process.stdout.write("null\n");
    return;
  }
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    ok: true,
    result: {
      rosAvailable: "false",
      rosDistro: "jazzy",
      rmwImplementation: "rmw_fastrtps_cpp",
      rosDomainId: "0",
      proposalTopic: "/rlsok/action_proposals",
      jointStateTopic: "/joint_states",
      controllerAction: "/joint_trajectory_controller/follow_joint_trajectory",
      discoveryTimeoutSeconds: 15,
      jointStateFresh: false,
      actionServerAvailable: "false",
      sros2Enabled: "false",
      limitations: ["invalid_boolean_fixture"],
    },
  })}\n`);
});

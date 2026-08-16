import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import {
  executablePolicyHash,
  type ExecutablePolicySpec,
} from "../../packages/core/exec-spec";

const apiVersion = "rlsok-cloud/v1";

async function main(): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-zero-to-shadow-"));
  let draft: { execSpec: ExecutablePolicySpec } | undefined;
  let approvedSpec: ExecutablePolicySpec | undefined;
  let evidenceBody: Record<string, unknown> | undefined;
  let permitBody: Record<string, unknown> | undefined;
  const permitId = "11111111-1111-4111-8111-111111111111";
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      : {};
    const path = request.url ?? "";
    let result: unknown;
    let status = 200;
    if (request.method === "POST" && path === "/v1/onboarding/shadow-drafts") {
      draft = body as unknown as { execSpec: ExecutablePolicySpec };
      status = 201;
      result = {
        apiVersion,
        releaseId: draft.execSpec.metadata.releaseId,
        contentHash: executablePolicyHash(draft.execSpec),
        state: "draft",
        approvalUrl: "https://rlsok.com/dashboard/releases?release=test",
      };
    } else if (request.method === "GET" && path.startsWith("/v1/releases/")) {
      assert(draft);
      approvedSpec ??= {
        ...draft.execSpec,
        evidence: {
          ...draft.execSpec.evidence,
          status: "approved",
          approvedBy: "acceptance-approver",
          approvedAt: new Date().toISOString(),
        },
      };
      result = {
        apiVersion,
        releaseId: approvedSpec.metadata.releaseId,
        contentHash: executablePolicyHash(approvedSpec),
        state: "approved",
        execSpec: approvedSpec,
      };
    } else if (request.method === "POST" && path === "/v1/permits") {
      permitBody = body;
      status = 201;
      result = {
        apiVersion,
        permitId,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      };
    } else if (
      request.method === "POST" &&
      path === `/v1/permits/${permitId}/consume`
    ) {
      result = { apiVersion, permitId, consumed: true };
    } else if (request.method === "POST" && path === "/v1/evidence") {
      evidenceBody = body;
      status = 201;
      result = {
        evidenceId,
        sequence: 0,
        previousHash: null,
        evidenceHash: "pending",
        createdAt: new Date().toISOString(),
      };
    } else if (request.method === "GET" && path === `/v1/evidence/${evidenceId}`) {
      assert(evidenceBody);
      const createdAt = new Date().toISOString();
      const record = {
        sequence: 0,
        previousHash: null,
        releaseId: evidenceBody.releaseId,
        permitId: evidenceBody.permitId,
        decision: evidenceBody.decision,
        hardwareSignalSent: evidenceBody.hardwareSignalSent,
        payload: evidenceBody.payload,
        createdAt,
      };
      result = {
        apiVersion,
        id: evidenceId,
        ...record,
        evidenceHash: sha256(canonicalJson(record)),
      };
    } else {
      status = 404;
      result = { error: `unhandled:${request.method}:${path}` };
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const config = join(temporary, "config");
  const data = join(temporary, "data");
  mkdirSync(join(config, "rlsok"), { recursive: true });
  writeFileSync(
    join(config, "rlsok", "cloud-credentials.json"),
    `${JSON.stringify({ apiUrl, apiKey: `rlsok_${"a".repeat(43)}` })}\n`,
    { mode: 0o600 },
  );
  const discoveryPath = join(temporary, "discovery.json");
  writeFileSync(
    discoveryPath,
    JSON.stringify({
      rosAvailable: true,
      rosDistro: "jazzy",
      rmwImplementation: "rmw_fastrtps_cpp",
      rosDomainId: "0",
      jointStateSources: [
        {
          name: "/joint_states",
          types: ["sensor_msgs/msg/JointState"],
          sample: {
            jointNames: ["joint_a", "joint_b"],
            positions: [0, 0],
            observedAt: new Date().toISOString(),
          },
        },
      ],
      trajectoryActionServers: [
        {
          name: "/joint_trajectory_controller/follow_joint_trajectory",
          types: ["control_msgs/action/FollowJointTrajectory"],
        },
      ],
      nodes: ["fixture"],
    }),
  );
  const artifact = join(temporary, "policy.bin");
  writeFileSync(artifact, "exact-policy-bytes\n");
  const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
  const sidecar = resolve(
    process.cwd(),
    "experimental/ros2-reference-sidecar/rlsok_ros2_simulated_sidecar.py",
  );
  const python = process.platform === "win32" ? "python" : "python3";
  const runSetup = async (): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> => {
    const child = spawn(
      process.execPath,
      [
        cli,
        "setup",
        "--artifact",
        artifact,
        "--cloud",
        apiUrl,
        "--non-interactive",
        "--no-browser",
        "--python",
        python,
        "--sidecar",
        sidecar,
      ],
      {
        env: {
          ...process.env,
          RLSOK_SETUP_ACCEPTANCE: "1",
          RLSOK_SETUP_DISCOVERY_FIXTURE: discoveryPath,
          RLSOK_DATA_HOME: data,
          ROS_DISTRO: "jazzy",
          RMW_IMPLEMENTATION: "rmw_fastrtps_cpp",
          XDG_CONFIG_HOME: config,
          LOCALAPPDATA: config,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.on("error", reject);
      child.on("exit", resolveExit);
    });
    return { exitCode, stdout, stderr };
  };
  const { exitCode, stdout, stderr } = await runSetup();
  try {
    assert.equal(exitCode, 0, `${stderr}\n${stdout}`);
    assert.match(stdout, /Zero-to-Shadow complete/);
    assert.match(stdout, /Controller goals attempted: 0/);
    assert.match(stdout, /Evidence verified by hash/);
    assert(draft);
    assert.equal(draft.execSpec.evidence.status, "tested");
    assert.match(draft.execSpec.approvedConfigurationDigest ?? "", /^[a-f0-9]{64}$/);
    assert.equal(
      permitBody?.configurationDigest,
      draft.execSpec.approvedConfigurationDigest,
    );
    const setup = JSON.parse(
      readFileSync(join(config, "rlsok", "setup.json"), "utf8"),
    ) as { evidencePath: string; artifactPath: string };
    const evidence = JSON.parse(readFileSync(setup.evidencePath, "utf8")) as {
      hardwareSignalSent: boolean;
      controllerGoalsAttempted: number;
      evidenceVerified: boolean;
    };
    assert.equal(evidence.hardwareSignalSent, false);
    assert.equal(evidence.controllerGoalsAttempted, 0);
    assert.equal(evidence.evidenceVerified, true);
    assert.equal(readFileSync(setup.artifactPath, "utf8"), "exact-policy-bytes\n");

    const baseDiscovery = {
      rosAvailable: true,
      rosDistro: "jazzy",
      rmwImplementation: "rmw_fastrtps_cpp",
      rosDomainId: "0",
      jointStateSources: [
        {
          name: "/joint_states",
          types: ["sensor_msgs/msg/JointState"],
          sample: {
            jointNames: ["joint_a"],
            positions: [0],
            observedAt: new Date().toISOString(),
          },
        },
      ],
      trajectoryActionServers: [
        {
          name: "/controller/follow_joint_trajectory",
          types: ["control_msgs/action/FollowJointTrajectory"],
        },
      ],
      nodes: ["fixture"],
    };
    const failureCases: Array<{
      name: string;
      discovery: Record<string, unknown>;
      expected: RegExp;
    }> = [
      {
        name: "ROS unavailable",
        discovery: { ...baseDiscovery, rosAvailable: false },
        expected: /source \/opt\/ros\/jazzy\/setup\.bash/i,
      },
      {
        name: "wrong ROS distribution",
        discovery: { ...baseDiscovery, rosDistro: "humble" },
        expected: /expected ROS 2 Jazzy but found 'humble'/i,
      },
      {
        name: "wrong DDS implementation",
        discovery: { ...baseDiscovery, rmwImplementation: "rmw_cyclonedds_cpp" },
        expected: /export RMW_IMPLEMENTATION=rmw_fastrtps_cpp/i,
      },
      {
        name: "missing JointState",
        discovery: { ...baseDiscovery, jointStateSources: [] },
        expected: /ros2 topic list -t[\s\S]*ROS_DOMAIN_ID/i,
      },
      {
        name: "JointState not publishing",
        discovery: {
          ...baseDiscovery,
          jointStateSources: [
            {
              name: "/joint_states",
              types: ["sensor_msgs/msg/JointState"],
              sample: null,
            },
          ],
        },
        expected: /ros2 topic echo --once <topic>/i,
      },
      {
        name: "missing trajectory controller",
        discovery: { ...baseDiscovery, trajectoryActionServers: [] },
        expected: /ros2 control list_controllers[\s\S]*ros2 action list -t/i,
      },
    ];
    for (const failureCase of failureCases) {
      writeFileSync(discoveryPath, JSON.stringify(failureCase.discovery));
      const failed = await runSetup();
      assert.notEqual(failed.exitCode, 0, failureCase.name);
      assert.match(`${failed.stderr}\n${failed.stdout}`, failureCase.expected, failureCase.name);
    }
    process.stdout.write("ok - zero-to-shadow acceptance\n");
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    rmSync(temporary, { recursive: true, force: true });
  }
}

void main();

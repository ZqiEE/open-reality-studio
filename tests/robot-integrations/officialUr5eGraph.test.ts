import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assessOfficialRobotIntegrations,
  type Ros2DiscoveryReport,
} from "../../packages/robot-integrations";

test(
  "official UR driver mock-hardware graph is identified without topic/action input",
  { skip: process.env.RLSOK_OFFICIAL_UR5E_TEST !== "1" },
  () => {
    const result = spawnSync(
      process.env.PYTHON ?? "python3",
      [
        resolve("experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py"),
        "--discover",
        "--discovery-timeout-seconds",
        "25",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as Ros2DiscoveryReport;
    const assessment = assessOfficialRobotIntegrations(report);
    assert.equal(
      assessment.status,
      "matched",
      assessment.status === "matched"
        ? undefined
        : assessment.diagnostics.join("\n"),
    );
    if (assessment.status !== "matched") return;
    const integration = assessment.integrations.find(
      (candidate) => candidate.model === "UR5e",
    );
    assert.ok(integration);
    assert.equal(integration.controllerType, "ur_controllers/ScaledJointTrajectoryController");
    assert.equal(integration.jointNames.length, 6);
    assert.equal(integration.physicalValidation, false);
    const output = resolve("artifacts/official-ur5e-integration.json");
    mkdirSync(resolve("artifacts"), { recursive: true });
    writeFileSync(
      output,
      `${JSON.stringify(
        {
          validation: "official-driver-mock-hardware-simulation",
          physicalRobotTested: false,
          profileId: integration.profileId,
          model: integration.model,
          namespace: integration.namespace,
          controllerType: integration.controllerType,
          jointNames: integration.jointNames,
          robotDescriptionSha256: integration.robotDescriptionSha256,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  },
);

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ros2DiscoveryReport } from "../../packages/robot-integrations";

export interface RosDiscoveryOptions {
  fixturePath?: string;
  timeoutMs?: number;
  pythonExecutable?: string;
  sidecarPath?: string;
}

export function defaultRosDiscoverySidecarPath(): string {
  return resolve(
    __dirname,
    "../../../experimental/ros2-reference-sidecar/rlsok_ros2_sidecar.py",
  );
}

/**
 * Shared, strictly read-only ROS graph discovery for setup and compatibility
 * inspection. The sidecar's --discover mode only reads graph metadata,
 * JointState samples, controller-manager state, and robot descriptions.
 */
export function discoverRos2Environment(
  options: RosDiscoveryOptions = {},
): Ros2DiscoveryReport {
  const fixture =
    options.fixturePath ??
    process.env.RLSOK_DISCOVERY_FIXTURE ??
    process.env.RLSOK_SETUP_DISCOVERY_FIXTURE;
  if (fixture) {
    return JSON.parse(readFileSync(fixture, "utf8")) as Ros2DiscoveryReport;
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Discovery timeout must be between 1000 and 120000 ms.");
  }
  const python = options.pythonExecutable ?? "python3";
  const sidecar = resolve(options.sidecarPath ?? defaultRosDiscoverySidecarPath());
  const result = spawnSync(
    python,
    [
      sidecar,
      "--discover",
      "--discovery-timeout-seconds",
      String(timeoutMs / 1_000),
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(
      `RLSOK could not start Python 3 (${result.error.message}). Install python3 and source /opt/ros/jazzy/setup.bash, then retry.`,
    );
  }
  try {
    return JSON.parse(result.stdout) as Ros2DiscoveryReport;
  } catch {
    throw new Error(
      `ROS discovery did not return a valid report. Run 'rlsok ros2 doctor' for technical diagnostics.${result.stderr.trim() ? ` Detail: ${result.stderr.trim()}` : ""}`,
    );
  }
}

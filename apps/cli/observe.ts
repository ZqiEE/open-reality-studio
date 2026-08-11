import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runRos2Command } from "./ros2";

interface SetupStateV2 {
  version: 2;
  releaseId: string;
  deviceId: string;
  jointStateTopic: string;
  controllerAction: string;
  proposalTopic: string;
  proposerIdentity: string;
  releasePath: string;
  evidencePath: string;
}

function setupPath(): string {
  const root =
    process.env.RLSOK_CONFIG_HOME ??
    (process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, "rlsok")
      : join(homedir(), ".config", "rlsok"));
  return join(root, "setup.json");
}

function readSetup(path: string): SetupStateV2 {
  if (!existsSync(path))
    throw new Error("No completed robot setup was found. Run 'rlsok setup' first.");
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<SetupStateV2>;
  if (
    value.version !== 2 ||
    !value.releaseId ||
    !value.deviceId ||
    !value.jointStateTopic ||
    !value.controllerAction ||
    !value.proposalTopic ||
    !value.proposerIdentity ||
    !value.releasePath
  )
    throw new Error(
      "The saved setup predates automatic robot integration. Run 'rlsok setup' again; RLSOK will not guess missing ROS boundary values.",
    );
  return value as SetupStateV2;
}

export function observeUsage(): string {
  return [
    "usage: rlsok observe [--setup <file>] [--evidence <file>]",
    "",
    "Continuously evaluate policy proposals in Shadow using the robot boundary saved by",
    "rlsok setup. No ROS topic or action names are required.",
  ].join("\n");
}

export async function runObserveCommand(args: string[]): Promise<number> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--help" || name === "-h") {
      process.stdout.write(`${observeUsage()}\n`);
      return 0;
    }
    if (!name?.startsWith("--"))
      throw new Error(`Unexpected argument ${name ?? ""}. Run rlsok observe --help.`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Option ${name} requires a value.`);
    options.set(name.slice(2), value);
  }
  const path = resolve(String(options.get("setup") ?? setupPath()));
  const state = readSetup(path);
  const evidence = resolve(
    String(
      options.get("evidence") ??
        state.evidencePath.replace(/\.json$/, `-observe-${Date.now()}.json`),
    ),
  );
  process.stdout.write(
    `Observing ${state.deviceId} in Shadow. Policy proposals publish through ${state.proposalTopic}; controller dispatch is disabled.\n`,
  );
  return runRos2Command([
    "shadow",
    "--release",
    state.releasePath,
    "--device",
    state.deviceId,
    "--proposer",
    state.proposerIdentity,
    "--joint-state-topic",
    state.jointStateTopic,
    "--controller-action",
    state.controllerAction,
    "--proposal-topic",
    state.proposalTopic,
    "--evidence",
    evidence,
  ]);
}

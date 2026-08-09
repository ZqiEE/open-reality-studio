import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import {
  RlsokCloudClient,
  loadCloudClientConfig,
  verifyCloudEvidence,
  verifyEvidenceChain,
  evidenceExportSchema,
} from "../../packages/cloud-client";
import {
  executablePolicySpecSchema,
  type ExecutablePolicySpec,
} from "../../packages/core/exec-spec";

function structured(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`input_file_missing:${path}`);
  }
  return load(readFileSync(resolved, "utf8"));
}

function release(path: string): ExecutablePolicySpec {
  return executablePolicySpecSchema.parse(structured(path));
}

function client(): RlsokCloudClient {
  return new RlsokCloudClient(loadCloudClientConfig());
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function cloudUsage(): string {
  return [
    "usage:",
    "  rlsok cloud register <release>",
    "  rlsok cloud get-release <release-id>",
    "  rlsok cloud approve <release-id>",
    "  rlsok cloud permit <request-json>",
    "  rlsok cloud consume <permit-id> <request-json>",
    "  rlsok cloud submit-evidence <evidence-json>",
    "  rlsok cloud get-evidence <evidence-id>",
    "  rlsok cloud verify-evidence <evidence-id>",
    "  rlsok cloud evidence export --output <file> [--release <release-id>]",
    "  rlsok cloud verify-evidence-chain <file>",
    "  rlsok cloud revoke <release-id> <reason>",
    "",
    "Hosted Cloud configuration is created by `rlsok pair`. Environment-based",
    "configuration remains available for advanced self-hosted deployments.",
    "API keys are never accepted as command arguments.",
  ].join("\n");
}

export async function runCloudCommand(args: string[]): Promise<number> {
  const [operation, ...rest] = args;
  if (operation === "help" || operation === "--help" || !operation) {
    process.stdout.write(`${cloudUsage()}\n`);
    return 0;
  }
  const cloud = client();
  if (operation === "register" && rest.length === 1) {
    output(await cloud.registerRelease(release(rest[0])));
    return 0;
  }
  if (operation === "get-release" && rest.length === 1) {
    output(await cloud.getRelease(rest[0]));
    return 0;
  }
  if (operation === "approve" && rest.length === 1) {
    output(await cloud.approveRelease(rest[0]));
    return 0;
  }
  if (operation === "permit" && rest.length === 1) {
    output(await cloud.requestPermit(structured(rest[0]) as never));
    return 0;
  }
  if (operation === "consume" && rest.length === 2) {
    output(await cloud.consumePermit(rest[0], structured(rest[1]) as never));
    return 0;
  }
  if (operation === "submit-evidence" && rest.length === 1) {
    output(await cloud.submitEvidence(structured(rest[0]) as never));
    return 0;
  }
  if (operation === "get-evidence" && rest.length === 1) {
    output(await cloud.getEvidence(rest[0]));
    return 0;
  }
  if (operation === "verify-evidence" && rest.length === 1) {
    const result = verifyCloudEvidence(await cloud.getEvidence(rest[0]));
    if (!result.ok) throw new Error(result.reason);
    process.stdout.write("PASS\n");
    return 0;
  }
  if (operation === "evidence" && rest[0] === "export") {
    const outputIndex = rest.indexOf("--output");
    const releaseIndex = rest.indexOf("--release");
    const outputPath = outputIndex >= 0 ? rest[outputIndex + 1] : undefined;
    const releaseId = releaseIndex >= 0 ? rest[releaseIndex + 1] : undefined;
    if (!outputPath) throw new Error("evidence_export_output_required");
    const exported = await cloud.exportEvidence(releaseId);
    writeFileSync(
      resolve(outputPath),
      `${JSON.stringify(exported, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    output({
      output: resolve(outputPath),
      records: exported.records.length,
      firstSequence: exported.firstSequence,
      lastSequence: exported.lastSequence,
    });
    return 0;
  }
  if (operation === "verify-evidence-chain" && rest.length === 1) {
    const exported = evidenceExportSchema.parse(structured(rest[0]));
    const result = verifyEvidenceChain(exported);
    if (!result.ok) throw new Error(result.reason);
    output(result);
    return 0;
  }
  if (operation === "revoke" && rest.length >= 2) {
    output(await cloud.revokeRelease(rest[0], rest.slice(1).join(" ")));
    return 0;
  }
  throw new Error("invalid_cloud_command");
}

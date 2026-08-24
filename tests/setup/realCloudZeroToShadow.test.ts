import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";

const contractVersion = "rlsok-cloud/v1";

async function jsonRequest(
  apiUrl: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    contract?: boolean;
    method?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(options.token
        ? { authorization: `Bearer ${options.token}` }
        : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.contract
        ? { "x-rlsok-contract-version": contractVersion }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.ok, true, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function main(): Promise<void> {
  const cli = process.env.RLSOK_INSTALLED_CLI;
  const apiUrl = process.env.RLSOK_CLOUD_API_URL?.replace(/\/$/, "");
  const organization = process.env.RLSOK_CLOUD_ORGANIZATION;
  const administratorEmail = process.env.RLSOK_CLOUD_ADMIN_EMAIL;
  const administratorPassword = process.env.RLSOK_CLOUD_ADMIN_PASSWORD;
  const approverKey = process.env.RLSOK_CLOUD_APPROVER_KEY;
  for (const [name, value] of Object.entries({
    RLSOK_INSTALLED_CLI: cli,
    RLSOK_CLOUD_API_URL: apiUrl,
    RLSOK_CLOUD_ORGANIZATION: organization,
    RLSOK_CLOUD_ADMIN_EMAIL: administratorEmail,
    RLSOK_CLOUD_ADMIN_PASSWORD: administratorPassword,
    RLSOK_CLOUD_APPROVER_KEY: approverKey,
  })) {
    assert(value, `${name} is required`);
  }

  const health = await jsonRequest(apiUrl!, "/healthz");
  assert.deepEqual(health, { status: "ok", version: "1.3.0" });
  const login = await jsonRequest(apiUrl!, "/v1/auth/login", {
    body: {
      organization,
      email: administratorEmail,
      password: administratorPassword,
    },
  });
  const administratorToken = String(login.token);
  assert.match(administratorToken, /^rlsok_[A-Za-z0-9_-]{43}$/);

  const temporary = mkdtempSync(join(tmpdir(), "rlsok-real-cloud-shadow-"));
  const config = join(temporary, "config");
  const data = join(temporary, "data");
  const artifact = join(temporary, "policy.bin");
  writeFileSync(artifact, "real-isolated-cloud-policy\n");
  mkdirSync(config, { recursive: true });

  let stdout = "";
  let stderr = "";
  let pairingApproved = false;
  let releaseApproved = false;
  let pairingCode: string | undefined;
  let releaseId: string | undefined;
  let approvalError: Error | undefined;
  const approvals: Promise<void>[] = [];
  const child = spawn(
    cli!,
    [
      "setup",
      "--artifact",
      artifact,
      "--cloud",
      apiUrl!,
      "--approval-timeout-minutes",
      "2",
      "--non-interactive",
      "--no-browser",
    ],
    {
      env: {
        ...process.env,
        RLSOK_SETUP_ACCEPTANCE: "1",
        RLSOK_DATA_HOME: data,
        XDG_CONFIG_HOME: config,
        LOCALAPPDATA: config,
        ROS_DISTRO: "jazzy",
        RMW_IMPLEMENTATION: "rmw_fastrtps_cpp",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const failApproval = (error: unknown) => {
    approvalError =
      error instanceof Error ? error : new Error("acceptance_approval_failed");
    child.kill("SIGTERM");
  };
  const inspectOutput = () => {
    if (!pairingApproved) {
      const match = stdout.match(/Pairing code:\s*([A-Z0-9]+)/);
      if (match?.[1]) {
        pairingApproved = true;
        pairingCode = match[1];
        approvals.push(
          jsonRequest(apiUrl!, "/v1/runtime-pairings/approve", {
            token: administratorToken,
            body: { userCode: pairingCode },
          })
            .then(() => undefined)
            .catch(failApproval),
        );
      }
    }
    if (!releaseApproved) {
      const match = stdout.match(/Draft\s+([^\s]+)\s+created/);
      if (match?.[1]) {
        releaseApproved = true;
        releaseId = match[1];
        approvals.push(
          jsonRequest(
            apiUrl!,
            `/v1/releases/${encodeURIComponent(releaseId)}/approve`,
            {
              token: approverKey,
              contract: true,
              body: {},
            },
          )
            .then(() => undefined)
            .catch(failApproval),
        );
      }
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    inspectOutput();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 180_000);
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  clearTimeout(timeout);
  await Promise.all(approvals);

  try {
    if (approvalError) throw approvalError;
    assert.equal(exitCode, 0, `${stderr}\n${stdout}`);
    assert(pairingCode, "real pairing code was not observed");
    assert(releaseId, "real Cloud draft was not observed");
    assert.match(stdout, /Zero-to-Shadow complete/);
    assert.match(stdout, /Controller goals attempted: 0/);
    assert.match(stdout, /Hardware signal sent: false/);
    assert.match(stdout, /Evidence verified by hash/);

    const setup = JSON.parse(
      readFileSync(join(config, "rlsok", "setup.json"), "utf8"),
    ) as {
      releaseId: string;
      releasePath: string;
      evidencePath: string;
      integration: { profileId: string };
      jointNames: string[];
    };
    const evidence = JSON.parse(readFileSync(setup.evidencePath, "utf8")) as {
      decision: string;
      reason: string;
      cloudPermitId: string;
      cloudPermitConsumed: boolean;
      localPermitConsumed: boolean;
      cloudEvidenceId: string;
      controllerGoalsAttempted: number;
      hardwareSignalSent: boolean;
      evidenceVerified: boolean;
    };
    assert.equal(setup.releaseId, releaseId);
    assert.equal(
      setup.integration.profileId,
      "universal-robots-ur5e-ros2-driver-jazzy",
    );
    assert.equal(setup.jointNames.length, 6);
    assert.equal(evidence.decision, "allowed");
    assert.equal(evidence.cloudPermitConsumed, true);
    assert.equal(evidence.localPermitConsumed, true);
    assert.equal(evidence.controllerGoalsAttempted, 0);
    assert.equal(evidence.hardwareSignalSent, false);
    assert.equal(evidence.evidenceVerified, true);
    assert.match(evidence.cloudPermitId, /^[0-9a-f-]{36}$/i);
    assert.match(evidence.cloudEvidenceId, /^[0-9a-f-]{36}$/i);

    const credentials = JSON.parse(
      readFileSync(join(config, "rlsok", "cloud-credentials.json"), "utf8"),
    ) as { apiKey: string };
    const storedEvidence = await jsonRequest(
      apiUrl!,
      `/v1/evidence/${evidence.cloudEvidenceId}`,
      { token: credentials.apiKey, contract: true },
    );
    assert.equal(storedEvidence.decision, "allowed");
    assert.equal(storedEvidence.hardware_signal_sent, false);
    const approvedRelease = load(readFileSync(setup.releasePath, "utf8")) as {
      evidence: { status: string; approvedBy: string };
    };
    assert.equal(approvedRelease.evidence.status, "approved");
    assert.equal(approvedRelease.evidence.approvedBy, "phase2-independent-approver");

    const proofPath = process.env.RLSOK_REAL_CLOUD_ACCEPTANCE_PROOF;
    if (proofPath) {
      mkdirSync(resolve(proofPath, ".."), { recursive: true });
      writeFileSync(
        proofPath,
        `${JSON.stringify(
          {
            sourceCommit:
              process.env.RLSOK_RUNTIME_SOURCE_COMMIT ??
              process.env.GITHUB_SHA ??
              null,
            cloudSourceCommit: process.env.RLSOK_CLOUD_SOURCE_COMMIT ?? null,
            cloud: "actual isolated rlsok-cloud API with isolated PostgreSQL",
            hostedProductionCloudTested: false,
            installedBundle: true,
            pairingCodeObserved: true,
            pairingApprovedByIndependentAdministrator: true,
            releaseId,
            releaseStateSequence: ["draft", "approved"],
            releaseApprovedByIndependentApprover: true,
            permitId: evidence.cloudPermitId,
            permitConsumed: evidence.cloudPermitConsumed,
            shadowDecision: evidence.decision,
            controllerGoalsAttempted: evidence.controllerGoalsAttempted,
            hardwareSignalSent: evidence.hardwareSignalSent,
            cloudEvidenceId: evidence.cloudEvidenceId,
            cloudEvidenceRetrievedAndVerified: evidence.evidenceVerified,
            integrationProfileId: setup.integration.profileId,
            jointCount: setup.jointNames.length,
            physicalRobotTested: false,
          },
          null,
          2,
        )}\n`,
      );
      process.stdout.write(`${readFileSync(proofPath, "utf8")}\n`);
    }
    process.stdout.write("ok - actual isolated Cloud installed-bundle Zero-to-Shadow\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

void main();

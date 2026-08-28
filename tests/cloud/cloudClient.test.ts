import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CloudClientError,
  CloudConnectedDispatchBoundary,
  CloudConnectedRos2Workflow,
  FileProposalReplayRegistry,
  InMemoryProposalReplayRegistry,
  RlsokCloudClient,
  assertLocalRos2Eligibility,
  executionMode,
  loadCloudClientConfig,
  submitEvidenceSchema,
  verifyEvidenceChain,
  type EvidenceExport,
  readStoredCloudCredentials,
  writeStoredCloudCredentials,
} from "../../packages/cloud-client";
import type { Ros2ReferenceTransport } from "../../packages/ros2-reference-gateway";
import { ros2ProposalEnvelopeSchema } from "../../packages/ros2-reference-gateway";
import {
  executablePolicyHash,
  executablePolicySpecSchema,
} from "../../packages/core/exec-spec";
import { canonicalJson, sha256 } from "../../packages/core/evidence";
import { configurationDigest as digestConfiguration } from "../../packages/core/execution-configuration";

const fixture = JSON.parse(
  readFileSync("fixtures/cloud-contract/v1/release.json", "utf8"),
) as {
  contractVersion: string;
  execSpec: unknown;
  action: unknown;
  expected: { contentHash: string; actionHash: string };
};

const config = {
  apiUrl: new URL("https://cloud.example.test"),
  apiKey: "rlsok_test_secret_value",
  timeoutMs: 1_000,
  maxResponseBytes: 1_024,
  safeRetryCount: 1,
};
const configurationDigest =
  "a0813bd26e47d0fdddbc1e116606650c3356c26833bd663a38b0b250773fdc15";

function currentExecutionConfiguration() {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  if (spec.executionConfiguration?.schemaVersion !== 1) {
    throw new Error("cloud v1 fixture must use ExecutionConfiguration v1");
  }
  return {
    ...spec.executionConfiguration!,
    observedAt: new Date().toISOString(),
  };
}

function json(
  value: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function evidenceBodyFromSubmission(value: any, createdAt: string) {
  return {
    sequence: 0,
    previousHash: null,
    releaseId: value.releaseId,
    permitId: value.permitId ?? null,
    decision: value.decision,
    hardwareSignalSent: value.hardwareSignalSent,
    payload: value.payload,
    createdAt,
  };
}

function claimInChild(
  directory: string,
  startFile: string,
  identity: unknown,
  maximumClaims = 65_536,
): Promise<string> {
  return new Promise((resolveClaim, rejectClaim) => {
    const child = spawn(process.execPath, [
      join(__dirname, "replayRegistryClaimWorker.js"),
      directory,
      startFile,
      JSON.stringify(identity),
      String(maximumClaims),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectClaim);
    child.once("exit", (code) => {
      if (code === 0) resolveClaim(stdout.trim());
      else rejectClaim(new Error(`replay claim worker exited ${code}: ${stderr}`));
    });
  });
}

test("file proposal replay registry survives restart and fails closed on corruption, capacity, and races", async () => {
  const root = mkdtempSync(join(tmpdir(), "rlsok-replay-registry-"));
  const identity = {
    releaseId: "fixture-release-001",
    executablePolicyHash: fixture.expected.contentHash,
    deviceId: "fixture-arm-01",
    proposerIdentity: "fixture-policy",
    proposalId: "restart-replay-001",
  };
  try {
    const durableRoot = join(root, "durable");
    const durableRegistry = new FileProposalReplayRegistry(durableRoot, 1);
    assert.deepEqual(durableRegistry.checkReady(), {
      ready: true,
      reason: "ready",
      remainingClaims: 1,
    });
    assert.equal(durableRegistry.claim(identity), "claimed");
    assert.deepEqual(durableRegistry.checkReady(), {
      ready: false,
      reason: "capacity_exceeded",
      remainingClaims: 0,
    });
    assert.equal(new FileProposalReplayRegistry(durableRoot, 1).claim(identity), "duplicate");
    assert.equal(new FileProposalReplayRegistry(durableRoot, 1).claim({
      ...identity,
      proposalId: "restart-replay-002",
    }), "capacity_exceeded");
    assert.equal(
      new FileProposalReplayRegistry(durableRoot, 2).claim(identity),
      "unavailable",
    );

    const partialRoot = join(root, "partial");
    const partialIdentity = { ...identity, proposalId: "partial-write" };
    mkdirSync(partialRoot, { recursive: true });
    writeFileSync(
      join(partialRoot, ".registry"),
      `${canonicalJson({
        schema: "rlsok.io/proposal-replay-registry/v1",
        maximumClaims: 10,
      })}\n`,
      "utf8",
    );
    writeFileSync(join(partialRoot, `${"0".repeat(64)}.claim`), "{", "utf8");
    assert.equal(
      new FileProposalReplayRegistry(partialRoot, 10).claim(partialIdentity),
      "unavailable",
    );
    assert.deepEqual(
      new FileProposalReplayRegistry(partialRoot, 10).checkReady(),
      { ready: false, reason: "unavailable", remainingClaims: 0 },
    );

    const unexpectedRoot = join(root, "unexpected-entry");
    assert.equal(new FileProposalReplayRegistry(unexpectedRoot, 10).claim(identity), "claimed");
    writeFileSync(join(unexpectedRoot, "unexpected-entry"), "corrupt\n", "utf8");
    assert.equal(new FileProposalReplayRegistry(unexpectedRoot, 10).claim({
      ...identity,
      proposalId: "restart-replay-003",
    }), "unavailable");

    const corruptMetadataRoot = join(root, "corrupt-metadata");
    mkdirSync(corruptMetadataRoot, { recursive: true });
    writeFileSync(join(corruptMetadataRoot, ".registry"), "{", "utf8");
    assert.equal(
      new FileProposalReplayRegistry(corruptMetadataRoot, 10).claim(identity),
      "unavailable",
    );

    const concurrentRoot = join(root, "concurrent");
    const startFile = join(root, "start-concurrent-claim");
    const first = claimInChild(concurrentRoot, startFile, identity);
    const second = claimInChild(concurrentRoot, startFile, identity);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    writeFileSync(startFile, "go\n", "utf8");
    const outcomes = await Promise.all([first, second]);
    assert.deepEqual([...outcomes].sort(), ["claimed", "duplicate"]);
    assert.equal(new FileProposalReplayRegistry(concurrentRoot).claim(identity), "duplicate");
    assert.equal(
      readdirSync(concurrentRoot).filter((entry) => entry.endsWith(".claim")).length,
      1,
    );

    const orphanStageRoot = join(root, "orphan-stage");
    const orphanStageDirectory = join(orphanStageRoot, ".staging");
    mkdirSync(orphanStageDirectory, { recursive: true });
    const orphanStage = join(
      orphanStageDirectory,
      ".stage-00000000-0000-4000-8000-000000000000.tmp",
    );
    writeFileSync(orphanStage, "{", "utf8");
    assert.equal(
      new FileProposalReplayRegistry(orphanStageRoot, 10).claim({
        ...identity,
        proposalId: "orphan-stage-recovery",
      }),
      "claimed",
    );
    assert.equal(existsSync(orphanStage), true);

    const capacityRaceRoot = join(root, "capacity-race");
    const capacityStartFile = join(root, "start-capacity-race");
    const capacityClaims = Array.from({ length: 8 }, (_unused, index) => claimInChild(
      capacityRaceRoot,
      capacityStartFile,
      { ...identity, proposalId: `capacity-race-${index}` },
      1,
    ));
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    writeFileSync(capacityStartFile, "go\n", "utf8");
    const capacityOutcomes = await Promise.all(capacityClaims);
    assert.equal(capacityOutcomes.filter((outcome) => outcome === "claimed").length, 1);
    assert.equal(
      capacityOutcomes.filter((outcome) => outcome === "capacity_exceeded").length,
      capacityClaims.length - 1,
    );
    assert.equal(
      readdirSync(capacityRaceRoot).filter((entry) => entry.endsWith(".claim")).length,
      1,
    );

    const capacityDriftRoot = join(root, "capacity-drift-race");
    const capacityDriftStartFile = join(root, "start-capacity-drift-race");
    const capacityDriftOutcomesPromise = Promise.all([
      claimInChild(capacityDriftRoot, capacityDriftStartFile, identity, 1),
      claimInChild(capacityDriftRoot, capacityDriftStartFile, identity, 2),
    ]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    writeFileSync(capacityDriftStartFile, "go\n", "utf8");
    const capacityDriftOutcomes = await capacityDriftOutcomesPromise;
    assert.equal(
      capacityDriftOutcomes.filter((outcome) => outcome === "claimed").length,
      1,
    );
    assert.ok(capacityDriftOutcomes.every((outcome) => [
      "claimed",
      "unavailable",
    ].includes(outcome)));
    const persistedCapacity = capacityDriftOutcomes[0] === "claimed" ? 1 : 2;
    assert.equal(
      new FileProposalReplayRegistry(capacityDriftRoot, persistedCapacity).claim(identity),
      "duplicate",
    );
    assert.equal(
      new FileProposalReplayRegistry(
        capacityDriftRoot,
        persistedCapacity === 1 ? 2 : 1,
      ).claim(identity),
      "unavailable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cross-repository fixture uses the public strict schema and canonical hashes", () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  assert.equal(fixture.contractVersion, "rlsok-cloud/v1");
  assert.equal(executablePolicyHash(spec), fixture.expected.contentHash);
  assert.equal(
    sha256(canonicalJson(fixture.action)),
    fixture.expected.actionHash,
  );
});

test("Cloud Evidence consumption tri-state rejects internally inconsistent claims", () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  const valid = {
    releaseId: spec.metadata.releaseId,
    permitId: "11111111-1111-4111-8111-111111111111",
    decision: "allowed" as const,
    hardwareSignalSent: false,
    payload: {
      contractVersion: "rlsok-cloud/v1" as const,
      evaluationMode: "shadow" as const,
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: spec.robot.controllerConfigSha256,
      expectedConfigurationDigest: configurationDigest,
      observedConfigurationDigest: configurationDigest,
      localPermitConsumed: true,
      cloudPermitConsumptionState: "consumed" as const,
      controllerGoalsAttempted: 0,
      reason: "shadow_permit_evaluated_no_controller_call",
    },
  };
  assert.equal(submitEvidenceSchema.safeParse(valid).success, true);
  assert.equal(submitEvidenceSchema.safeParse({
    ...valid,
    payload: {
      ...valid.payload,
      cloudPermitConsumptionState: "unknown",
    },
  }).success, false);
  assert.equal(submitEvidenceSchema.safeParse({
    ...valid,
    hardwareSignalSent: true,
  }).success, false);
  assert.equal(submitEvidenceSchema.safeParse({
    ...valid,
    decision: "blocked",
    hardwareSignalSent: false,
    payload: {
      ...valid.payload,
      evaluationMode: "denial",
      controllerGoalsAttempted: 0,
      controllerResult: {
        accepted: true,
        completed: true,
        succeeded: true,
        detail: "fabricated_without_attempt",
      },
    },
  }).success, false);
});

test("cloud ROS 2 eligibility fails closed when the current time is invalid", () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  const proposal = ros2ProposalEnvelopeSchema.parse({
    proposalId: "invalid-current-time",
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt: new Date().toISOString(),
  });
  assert.throws(
    () => assertLocalRos2Eligibility(
      spec,
      proposal,
      spec.robot.controllerConfigSha256,
      "shadow",
      new Date(Number.NaN),
    ),
    /release_time_invalid/,
  );
});

test("cloud-connected mode never silently falls back to standalone", () => {
  assert.equal(executionMode({}), "standalone");
  assert.equal(
    executionMode({ RLSOK_EXECUTION_MODE: "cloud-connected" }),
    "cloud-connected",
  );
  assert.throws(
    () =>
      loadCloudClientConfig({
        RLSOK_CLOUD_API_URL: "https://cloud.example.test",
      }),
    /RLSOK_CLOUD_API_KEY_is_required/,
  );
  assert.throws(
    () =>
      loadCloudClientConfig({
        RLSOK_CLOUD_API_URL: "http://cloud.example.test",
        RLSOK_CLOUD_API_KEY: "secret",
      }),
    /requires_https/,
  );
});

test("browser pairing credentials persist outside the repository and load without environment secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "rlsok-pairing-test-"));
  const source = process.platform === "win32"
    ? { LOCALAPPDATA: directory }
    : { XDG_CONFIG_HOME: directory };
  try {
    const path = writeStoredCloudCredentials(
      { apiUrl: "https://api.rlsok.com", apiKey: `rlsok_${"a".repeat(43)}` },
      source,
    );
    assert.ok(path.startsWith(directory));
    assert.deepEqual(readStoredCloudCredentials(source), {
      apiUrl: "https://api.rlsok.com",
      apiKey: `rlsok_${"a".repeat(43)}`,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GET retries once but state-changing requests are never retried", async () => {
  let getAttempts = 0;
  const getClient = new RlsokCloudClient(config, async () => {
    getAttempts += 1;
    if (getAttempts === 1) throw new TypeError("temporary network failure");
    return json({
      apiVersion: "rlsok-cloud/v1",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      state: "approved",
    });
  });
  assert.equal(
    (await getClient.getRelease("fixture-release-001")).state,
    "approved",
  );
  assert.equal(getAttempts, 2);

  let mutationAttempts = 0;
  const mutationClient = new RlsokCloudClient(config, async () => {
    mutationAttempts += 1;
    throw new TypeError("network failure");
  });
  await assert.rejects(
    mutationClient.approveRelease("fixture-release-001"),
    /network failure/,
  );
  assert.equal(mutationAttempts, 1);
});

test("Evidence export rejects unbounded pagination and changing server scope", async () => {
  let pageCalls = 0;
  const unbounded = new RlsokCloudClient(
    { ...config, maxResponseBytes: 64 * 1024 },
    async () => {
      pageCalls += 1;
      return json({
        apiVersion: "rlsok-cloud/v1",
        organizationFingerprint: "a".repeat(64),
        releaseFilter: null,
        firstSequence: null,
        lastSequence: null,
        nextAfterSequence: pageCalls - 1,
        records: [],
      });
    },
  );
  await assert.rejects(
    unbounded.exportEvidence(),
    /evidence_export_page_limit_exceeded/,
  );
  assert.equal(pageCalls, 64);

  const wrongFilter = new RlsokCloudClient(config, async () => json({
    apiVersion: "rlsok-cloud/v1",
    organizationFingerprint: "a".repeat(64),
    releaseFilter: null,
    firstSequence: null,
    lastSequence: null,
    nextAfterSequence: null,
    records: [],
  }));
  await assert.rejects(
    wrongFilter.exportEvidence("fixture-release-001"),
    /evidence_export_release_filter_changed/,
  );

  const oversizedPage = new RlsokCloudClient(
    { ...config, maxResponseBytes: 64 * 1024 },
    async () => json({
      apiVersion: "rlsok-cloud/v1",
      organizationFingerprint: "a".repeat(64),
      releaseFilter: null,
      firstSequence: 0,
      lastSequence: 200,
      nextAfterSequence: null,
      records: Array.from({ length: 201 }, () => ({})),
    }),
  );
  await assert.rejects(
    oversizedPage.exportEvidence(),
    /evidence_export_page_size_exceeded/,
  );
});

test("idempotent mutations retry an ambiguous transport failure with one stable key", async () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  const cases = [
    {
      invoke: (client: RlsokCloudClient) =>
        client.registerRelease(spec, "register-ambiguous-result-0001"),
      response: {
        apiVersion: "rlsok-cloud/v1",
        releaseId: spec.metadata.releaseId,
        contentHash: fixture.expected.contentHash,
      },
    },
    {
      invoke: (client: RlsokCloudClient) =>
        client.requestPermit(
          {
            evaluationMode: "shadow",
            releaseId: spec.metadata.releaseId,
            contentHash: fixture.expected.contentHash,
            actionHash: fixture.expected.actionHash,
            deviceId: "fixture-arm-01",
            controllerId: spec.robot.controllerConfigSha256,
            configurationDigest,
            expiresInSeconds: 30,
          },
          "permit-ambiguous-result-000001",
        ),
      response: {
        apiVersion: "rlsok-cloud/v1",
        permitId: "11111111-1111-4111-8111-111111111111",
        expiresAt: "2026-01-01T00:00:30.000Z",
      },
    },
    {
      invoke: (client: RlsokCloudClient) =>
        client.submitEvidence(
          {
            releaseId: spec.metadata.releaseId,
            permitId: "11111111-1111-4111-8111-111111111111",
            decision: "allowed",
            hardwareSignalSent: false,
            payload: {
              contractVersion: "rlsok-cloud/v1",
              evaluationMode: "shadow",
              contentHash: fixture.expected.contentHash,
              actionHash: fixture.expected.actionHash,
              deviceId: "fixture-arm-01",
              controllerId: spec.robot.controllerConfigSha256,
              expectedConfigurationDigest: configurationDigest,
              observedConfigurationDigest: configurationDigest,
              localPermitConsumed: true,
              cloudPermitConsumptionState: "consumed",
              controllerGoalsAttempted: 0,
              reason: "shadow_permit_evaluated_no_controller_call",
            },
          },
          "evidence-ambiguous-result-0001",
        ),
      response: {
        apiVersion: "rlsok-cloud/v1",
        evidenceId: "22222222-2222-4222-8222-222222222222",
        sequence: 0,
        previousHash: null,
        evidenceHash: "3".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ];
  for (const item of cases) {
    const keys: string[] = [];
    let attempts = 0;
    const client = new RlsokCloudClient(config, async (_input, init) => {
      attempts += 1;
      keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      if (attempts === 1) throw new TypeError("response_lost_after_commit");
      return json(item.response, 201);
    });
    await item.invoke(client);
    assert.equal(attempts, 2);
    assert.ok(keys[0]);
    assert.equal(keys[0], keys[1]);
  }
});

test("redirects, malformed responses, oversized bodies, and non-2xx fail closed", async () => {
  const redirect = new RlsokCloudClient(
    config,
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/v1/releases/x" },
      }),
  );
  await assert.rejects(
    redirect.getRelease("x"),
    (error: unknown) =>
      error instanceof CloudClientError &&
      error.code === "cloud_redirect_rejected",
  );

  const malformed = new RlsokCloudClient(config, async () => new Response("{"));
  await assert.rejects(malformed.getRelease("x"), /cloud_response_malformed/);

  const oversized = new RlsokCloudClient(
    { ...config, maxResponseBytes: 10 },
    async () => new Response("x".repeat(11)),
  );
  await assert.rejects(oversized.getRelease("x"), /cloud_response_too_large/);

  const denied = new RlsokCloudClient(config, async () =>
    json({ error: "unauthorized" }, 401),
  );
  await assert.rejects(
    denied.getRelease("x"),
    (error: unknown) =>
      error instanceof CloudClientError &&
      error.message === "unauthorized" &&
      !error.message.includes(config.apiKey),
  );
});

test("new runtime detects old Cloud Permit consume as an actionable rollout incompatibility", async () => {
  const permitId = "11111111-1111-4111-8111-111111111111";
  let dispatches = 0;
  const oldCloud = new RlsokCloudClient(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "GET") {
      return json({
        apiVersion: "rlsok-cloud/v1",
        releaseId: "fixture-release-001",
        contentHash: fixture.expected.contentHash,
        state: "approved",
      });
    }
    if (path.endsWith(`/permits/${permitId}/consume`)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.evaluationMode, "shadow");
      return json({ error: "invalid_request" }, 400);
    }
    throw new Error(`unexpected_old_cloud_request:${path}`);
  });
  const boundary = new CloudConnectedDispatchBoundary(
    oldCloud,
    permitId,
    {
      evaluationMode: "shadow",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "fixture-controller-01",
      configurationDigest,
    },
    {
      async dispatch() {
        dispatches += 1;
        return "dispatched";
      },
    },
    async () => configurationDigest,
  );
  const action = fixture.action;
  const localPermit = boundary.issueLocalPermit(action);
  await assert.rejects(
    boundary.dispatch(action, localPermit),
    (error: unknown) =>
      error instanceof CloudClientError &&
      error.status === 400 &&
      error.code ===
        "cloud_runtime_incompatible:upgrade_cloud_before_runtime",
  );
  assert.equal(dispatches, 0);
});

test("new runtime Permit consume remains compatible with new Cloud", async () => {
  const permitId = "11111111-1111-4111-8111-111111111111";
  let consumeBody: Record<string, unknown> | undefined;
  const newCloud = new RlsokCloudClient(config, async (_input, init) => {
    consumeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return json({ apiVersion: "rlsok-cloud/v1", permitId, consumed: true });
  });
  const result = await newCloud.consumePermit(permitId, {
    evaluationMode: "shadow",
    releaseId: "fixture-release-001",
    contentHash: fixture.expected.contentHash,
    actionHash: fixture.expected.actionHash,
    deviceId: "fixture-arm-01",
    controllerId: "fixture-controller-01",
    configurationDigest,
  });
  assert.equal(result.consumed, true);
  assert.equal(consumeBody?.evaluationMode, "shadow");
});

test("cloud dispatch boundary requires and consumes its exact local permit before dispatch", async () => {
  const calls: string[] = [];
  const permitId = "11111111-1111-4111-8111-111111111111";
  const client = new RlsokCloudClient(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method}:${path}`);
    if (init?.method === "GET") {
      return json({
        apiVersion: "rlsok-cloud/v1",
        releaseId: "fixture-release-001",
        contentHash: fixture.expected.contentHash,
        state: "approved",
      });
    }
    return json({ apiVersion: "rlsok-cloud/v1", permitId, consumed: true });
  });
  let dispatches = 0;
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    {
      evaluationMode: "reference-run",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId:
        "1111111111111111111111111111111111111111111111111111111111111111",
      configurationDigest,
    },
    {
      async dispatch() {
        dispatches += 1;
        calls.push("controller:dispatch");
        return "accepted";
      },
    },
    async () => configurationDigest,
  );
  await assert.rejects(
    boundary.dispatch(fixture.action, {}),
    /local_execution_permit_invalid/,
  );
  assert.equal(calls.length, 0);
  assert.equal(dispatches, 0);

  const validBoundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    {
      evaluationMode: "reference-run",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId:
        "1111111111111111111111111111111111111111111111111111111111111111",
      configurationDigest,
    },
    {
      async dispatch() {
        dispatches += 1;
        calls.push("controller:dispatch");
        return "accepted";
      },
    },
    async () => configurationDigest,
  );
  const localPermit = validBoundary.issueLocalPermit(fixture.action);
  assert.equal(
    await validBoundary.dispatch(fixture.action, localPermit),
    "accepted",
  );
  assert.deepEqual(calls, [
    "GET:/v1/releases/fixture-release-001",
    `POST:/v1/permits/${permitId}/consume`,
    "controller:dispatch",
  ]);
  assert.equal(dispatches, 1);
  await assert.rejects(
    validBoundary.dispatch(fixture.action, localPermit),
    /boundary_reused/,
  );
});

test("cloud dispatch boundary snapshots binding and adapter-visible action bytes", async () => {
  const permitId = "11111111-1111-4111-8111-111111111111";
  const mutableAction = structuredClone(fixture.action) as any;
  const mutableBinding = {
    evaluationMode: "reference-run" as const,
    releaseId: "fixture-release-001",
    contentHash: fixture.expected.contentHash,
    actionHash: fixture.expected.actionHash,
    deviceId: "fixture-arm-01",
    controllerId:
      "1111111111111111111111111111111111111111111111111111111111111111",
    configurationDigest,
  };
  let dispatchedAction: unknown;
  const client = new RlsokCloudClient(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "GET") {
      assert.equal(path, "/v1/releases/fixture-release-001");
      mutableAction.points[0].positions[0] = 123;
      return json({
        apiVersion: "rlsok-cloud/v1",
        releaseId: "fixture-release-001",
        contentHash: fixture.expected.contentHash,
        state: "approved",
      });
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.releaseId, "fixture-release-001");
    assert.equal(body.deviceId, "fixture-arm-01");
    return json({ apiVersion: "rlsok-cloud/v1", permitId, consumed: true });
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    mutableBinding,
    {
      async dispatch(action) {
        dispatchedAction = action;
        return "accepted";
      },
    },
    async () => configurationDigest,
  );
  const permit = boundary.issueLocalPermit(mutableAction);
  mutableBinding.releaseId = "attacker-release";
  mutableBinding.deviceId = "attacker-device";
  assert.equal(await boundary.dispatch(mutableAction, permit), "accepted");
  assert.equal(sha256(canonicalJson(dispatchedAction)), fixture.expected.actionHash);
  assert.notEqual(sha256(canonicalJson(mutableAction)), fixture.expected.actionHash);
  assert.notEqual(dispatchedAction, mutableAction);
});

test("cloud dispatch boundary rejects a mismatched final release identity", async () => {
  let permitConsumptions = 0;
  const permitId = "11111111-1111-4111-8111-111111111111";
  const client = new RlsokCloudClient(config, async (_input, init) => {
    if (init?.method === "GET") {
      return json({
        apiVersion: "rlsok-cloud/v1",
        releaseId: "substituted-release",
        contentHash: fixture.expected.contentHash,
        state: "approved",
      });
    }
    permitConsumptions += 1;
    return json({ apiVersion: "rlsok-cloud/v1", permitId, consumed: true });
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    {
      evaluationMode: "reference-run",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "fixture-controller-01",
      configurationDigest,
    },
    { async dispatch() { throw new Error("must_not_dispatch"); } },
    async () => configurationDigest,
  );
  const permit = boundary.issueLocalPermit(fixture.action);
  await assert.rejects(
    boundary.dispatch(fixture.action, permit),
    /cloud_release_not_currently_approved/,
  );
  assert.equal(permitConsumptions, 0);
});

test("revocation refresh denies before permit consumption or controller dispatch", async () => {
  let calls = 0;
  const client = new RlsokCloudClient(config, async () => {
    calls += 1;
    return json({
      apiVersion: "rlsok-cloud/v1",
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      state: "revoked",
    });
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    "11111111-1111-4111-8111-111111111111",
    {
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "controller",
      configurationDigest,
      evaluationMode: "reference-run",
    },
    {
      async dispatch() {
        throw new Error("must_not_dispatch");
      },
    },
    async () => configurationDigest,
  );
  const localPermit = boundary.issueLocalPermit(fixture.action);
  await assert.rejects(
    boundary.dispatch(fixture.action, localPermit),
    /cloud_release_not_currently_approved/,
  );
  assert.equal(calls, 1);
});

test("cloud dispatch boundary rejects a local permit at its exact expiry", async (context) => {
  let cloudCalls = 0;
  let dispatches = 0;
  const client = new RlsokCloudClient(config, async () => {
    cloudCalls += 1;
    throw new Error("cloud_must_not_be_called");
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    "11111111-1111-4111-8111-111111111111",
    {
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "controller",
      configurationDigest,
      evaluationMode: "reference-run",
    },
    {
      async dispatch() {
        dispatches += 1;
        return "must_not_dispatch";
      },
    },
    async () => configurationDigest,
  );
  const permit = boundary.issueLocalPermit(fixture.action, 1_000);
  context.mock.method(Date, "now", () => 2_000);
  await assert.rejects(
    boundary.dispatch(fixture.action, permit),
    /local_execution_permit_invalid/,
  );
  assert.equal(cloudCalls, 0);
  assert.equal(dispatches, 0);
});

test("cloud dispatch boundary fails closed for an invalid local clock", async (context) => {
  let cloudCalls = 0;
  const client = new RlsokCloudClient(config, async () => {
    cloudCalls += 1;
    throw new Error("cloud_must_not_be_called");
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    "11111111-1111-4111-8111-111111111111",
    {
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "controller",
      configurationDigest,
      evaluationMode: "reference-run",
    },
    { async dispatch() { throw new Error("must_not_dispatch"); } },
    async () => configurationDigest,
  );
  assert.throws(
    () => boundary.issueLocalPermit(fixture.action, Number.NaN),
    /local_execution_permit_time_invalid/,
  );
  const permit = boundary.issueLocalPermit(fixture.action, 1_000);
  context.mock.method(Date, "now", () => Number.NaN);
  await assert.rejects(
    boundary.dispatch(fixture.action, permit),
    /local_execution_permit_invalid/,
  );
  assert.equal(cloudCalls, 0);
});

test("cloud dispatch boundary expires on actual elapsed time even when wall time is frozen", async (context) => {
  let monotonicNow = 1_000;
  let cloudCalls = 0;
  context.mock.method(Date, "now", () => 1_000);
  const client = new RlsokCloudClient(config, async () => {
    cloudCalls += 1;
    throw new Error("cloud_must_not_be_called");
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    "11111111-1111-4111-8111-111111111111",
    {
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "controller",
      configurationDigest,
      evaluationMode: "reference-run",
    },
    { async dispatch() { throw new Error("must_not_dispatch"); } },
    async () => configurationDigest,
    undefined,
    () => monotonicNow,
  );
  const permit = boundary.issueLocalPermit(fixture.action);
  monotonicNow = 2_000;
  await assert.rejects(
    boundary.dispatch(fixture.action, permit),
    /local_execution_permit_invalid/,
  );
  assert.equal(cloudCalls, 0);
});

test("cloud dispatch boundary rechecks local expiry after final refresh", async (context) => {
  let now = 1_000;
  let permitConsumptions = 0;
  let dispatches = 0;
  context.mock.method(Date, "now", () => now);
  const permitId = "11111111-1111-4111-8111-111111111111";
  const client = new RlsokCloudClient(config, async (_input, init) => {
    if (init?.method === "GET") {
      now = 2_000;
      return json({
        apiVersion: "rlsok-cloud/v1",
        releaseId: "fixture-release-001",
        contentHash: fixture.expected.contentHash,
        state: "approved",
      });
    }
    permitConsumptions += 1;
    return json({ apiVersion: "rlsok-cloud/v1", permitId, consumed: true });
  });
  const boundary = new CloudConnectedDispatchBoundary(
    client,
    permitId,
    {
      releaseId: "fixture-release-001",
      contentHash: fixture.expected.contentHash,
      actionHash: fixture.expected.actionHash,
      deviceId: "fixture-arm-01",
      controllerId: "controller",
      configurationDigest,
      evaluationMode: "reference-run",
    },
    {
      async dispatch() {
        dispatches += 1;
        return "must_not_dispatch";
      },
    },
    async () => configurationDigest,
  );
  const permit = boundary.issueLocalPermit(fixture.action);
  await assert.rejects(
    boundary.dispatch(fixture.action, permit),
    /local_execution_permit_expired/,
  );
  assert.equal(boundary.localPermitWasConsumed, true);
  assert.equal(boundary.cloudPermitConsumptionState, "not_consumed");
  assert.equal(permitConsumptions, 0);
  assert.equal(dispatches, 0);
});

test("cloud configuration drift after Permit issuance blocks before cloud consumption and dispatch", async () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  const current = currentExecutionConfiguration();
  const drifted = {
    ...current,
    controller: {
      ...current.controller,
      followJointTrajectoryAction: "/changed/follow_joint_trajectory",
    },
  };
  let observations = 0;
  let permitConsumptions = 0;
  let dispatches = 0;
  let submitted: any;
  let substituteRetrievedEvidence = false;
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const createdAt = new Date().toISOString();
  const cloud = {
    async getRelease() {
      return {
        releaseId: spec.metadata.releaseId,
        contentHash: executablePolicyHash(spec),
        state: "approved" as const,
      };
    },
    async requestPermit(request: any) {
      assert.equal(request.configurationDigest, configurationDigest);
      assert.equal(request.evaluationMode, "shadow");
      return {
        permitId: "11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      };
    },
    async consumePermit() {
      permitConsumptions += 1;
      throw new Error("permit_must_not_be_consumed_after_drift");
    },
    async submitEvidence(value: any) {
      submitted = value;
      return {
        evidenceId,
        sequence: 0,
        previousHash: null,
        evidenceHash: sha256(canonicalJson(evidenceBodyFromSubmission(value, createdAt))),
        createdAt,
      };
    },
    async getEvidence() {
      const expectedBody = evidenceBodyFromSubmission(submitted, createdAt);
      const body = substituteRetrievedEvidence
        ? {
            ...expectedBody,
            payload: { ...expectedBody.payload, reason: "self_consistent_substitution" },
          }
        : expectedBody;
      return { id: evidenceId, ...body, evidenceHash: sha256(canonicalJson(body)) };
    },
  } as unknown as RlsokCloudClient;
  const transport = {
    async getFreshJointState() {
      return {
        names: ["joint_a", "joint_b"],
        positions: [0, 0],
        observedAt: new Date().toISOString(),
      };
    },
    async dispatchTrajectory() {
      dispatches += 1;
      throw new Error("dispatch_must_not_happen_after_drift");
    },
  } as unknown as Ros2ReferenceTransport;
  const workflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => {
      observations += 1;
      return observations === 1 ? current : drifted;
    },
    localEvidence: () => undefined,
  });
  const result = await workflow.runProposal(JSON.stringify({
    proposalId: "cloud-configuration-drift",
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt,
  }));
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "configuration_mismatch");
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(permitConsumptions, 0);
  assert.equal(dispatches, 0);
  assert.equal(submitted.payload.expectedConfigurationDigest, configurationDigest);
  assert.equal(
    submitted.payload.observedConfigurationDigest,
    digestConfiguration(drifted),
  );

  substituteRetrievedEvidence = true;
  const substitutedWorkflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => drifted,
    localEvidence: () => undefined,
  });
  await assert.rejects(
    substitutedWorkflow.runProposal(JSON.stringify({
      proposalId: "cloud-evidence-substitution",
      releaseId: spec.metadata.releaseId,
      deviceId: spec.deployment.allowedDeviceIds[0],
      proposerIdentity: "fixture-policy",
      actionRepresentation: "trajectory",
      actionPayload: fixture.action,
      createdAt,
    })),
    /evidence_receipt_mismatch/,
  );
});

test("run Evidence preserves controller rejection and final stale state blocks before consume", async () => {
  const base = executablePolicySpecSchema.parse(fixture.execSpec);
  const spec = executablePolicySpecSchema.parse({
    ...base,
    deployment: { ...base.deployment, mode: "released" },
  });
  const createdAt = new Date().toISOString();
  const evidenceId = "44444444-4444-4444-8444-444444444444";
  let submitted: any;
  let permitRequests = 0;
  let permitConsumptions = 0;
  let dispatches = 0;
  let staleFinalState = false;
  let consumeOutcomeUnknown = false;
  let permitRequestFailure = false;
  let stateReads = 0;
  const cloud = {
    async getRelease() {
      return {
        releaseId: spec.metadata.releaseId,
        contentHash: executablePolicyHash(spec),
        state: "approved" as const,
      };
    },
    async requestPermit(request: any) {
      permitRequests += 1;
      assert.equal(request.evaluationMode, "reference-run");
      if (permitRequestFailure) throw new Error("permit_response_lost");
      return {
        permitId: "11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      };
    },
    async consumePermit() {
      permitConsumptions += 1;
      if (consumeOutcomeUnknown) throw new Error("consume_response_lost");
    },
    async submitEvidence(value: any) {
      submitted = value;
      const body = evidenceBodyFromSubmission(value, createdAt);
      return {
        evidenceId,
        sequence: body.sequence,
        previousHash: body.previousHash,
        evidenceHash: sha256(canonicalJson(body)),
        createdAt,
      };
    },
    async getEvidence() {
      const body = evidenceBodyFromSubmission(submitted, createdAt);
      return { id: evidenceId, ...body, evidenceHash: sha256(canonicalJson(body)) };
    },
  } as unknown as RlsokCloudClient;
  let controllerResponse: Awaited<
    ReturnType<Ros2ReferenceTransport["dispatchTrajectory"]>
  > = {
    accepted: false,
    completed: false,
    succeeded: false,
    detail: "controller_rejected_fixture",
  };
  const transport = {
    async getFreshJointState() {
      stateReads += 1;
      const finalRead = stateReads % 2 === 0;
      return {
        names: ["joint_a", "joint_b"],
        positions: [0, 0],
        observedAt: staleFinalState && finalRead
          ? new Date(
              Date.now() - spec.runtimePolicy.maxStateAgeMs - 1_000,
            ).toISOString()
          : new Date().toISOString(),
      };
    },
    async dispatchTrajectory() {
      dispatches += 1;
      return controllerResponse;
    },
  } as unknown as Ros2ReferenceTransport;
  const payload = (proposalId: string) => JSON.stringify({
    proposalId,
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt,
  });
  const options = {
    mode: "run" as const,
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    localEvidence: () => undefined,
    proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
  };

  assert.throws(
    () => new CloudConnectedRos2Workflow({
      ...options,
      proposalReplayRegistry: undefined,
    }),
    /proposal_replay_registry_required/,
  );

  const rejected = await new CloudConnectedRos2Workflow(options).runProposal(
    payload("controller-rejection"),
  );
  assert.equal(rejected.decision, "failed");
  assert.equal(
    rejected.reason,
    "controller_goal_rejected:controller_rejected_fixture",
  );
  assert.deepEqual(rejected.controllerResult, {
    accepted: false,
    completed: false,
    succeeded: false,
    status: undefined,
    errorCode: undefined,
    errorString: undefined,
    detail: "controller_rejected_fixture",
  });
  assert.deepEqual(submitted.payload.controllerResult, rejected.controllerResult);
  assert.equal(rejected.hardwareSignalSent, true);
  assert.equal(rejected.cloudPermitConsumptionState, "consumed");
  assert.equal(permitConsumptions, 1);
  assert.equal(dispatches, 1);

  permitRequestFailure = true;
  const localFailures: any[] = [];
  await assert.rejects(
    new CloudConnectedRos2Workflow({
      ...options,
      proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
      localEvidence: (result) => {
        localFailures.push(structuredClone(result));
      },
    }).runProposal(payload("permit-request-unknown")),
    /permit_response_lost/,
  );
  assert.equal(localFailures.length, 1);
  assert.equal(localFailures[0].reason, "permit_response_lost");
  assert.equal(localFailures[0].decision, "blocked");
  assert.equal(localFailures[0].controllerGoalsAttempted, 0);
  assert.equal(localFailures[0].hardwareSignalSent, false);
  assert.equal(localFailures[0].evidenceVerified, false);
  permitRequestFailure = false;

  staleFinalState = true;
  stateReads = 0;
  const stale = await new CloudConnectedRos2Workflow(options).runProposal(
    payload("stale-at-final-boundary"),
  );
  assert.equal(stale.decision, "blocked");
  assert.equal(stale.reason, "state_stale_or_invalid");
  assert.equal(stale.cloudPermitConsumed, false);
  assert.equal(stale.cloudPermitConsumptionState, "not_consumed");
  assert.equal(stale.controllerGoalsAttempted, 0);
  assert.equal(stale.hardwareSignalSent, false);
  assert.equal(permitRequests, 3);
  assert.equal(permitConsumptions, 1);
  assert.equal(dispatches, 1);

  staleFinalState = false;
  stateReads = 0;
  consumeOutcomeUnknown = true;
  const unknown = await new CloudConnectedRos2Workflow(options).runProposal(
    payload("unknown-consume-outcome"),
  );
  assert.equal(unknown.decision, "blocked");
  assert.equal(unknown.reason, "consume_response_lost");
  assert.equal(unknown.cloudPermitConsumed, false);
  assert.equal(unknown.cloudPermitConsumptionState, "unknown");
  assert.equal(unknown.controllerGoalsAttempted, 0);
  assert.equal(unknown.hardwareSignalSent, false);
  assert.equal(dispatches, 1);

  consumeOutcomeUnknown = false;
  const expiresAtMs = Date.now() + 60_000;
  const expiringSpec = executablePolicySpecSchema.parse({
    ...spec,
    deployment: {
      ...spec.deployment,
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  });
  let authorityNow = new Date(expiresAtMs - 1);
  const expiringCloud = {
    ...cloud,
    async getRelease() {
      return {
        releaseId: expiringSpec.metadata.releaseId,
        contentHash: executablePolicyHash(expiringSpec),
        state: "approved" as const,
      };
    },
  } as unknown as RlsokCloudClient;
  const expiredAtFinalBoundary = await new CloudConnectedRos2Workflow({
    ...options,
    release: expiringSpec,
    cloud: expiringCloud,
    proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
    now: () => authorityNow,
    beforeFinalBoundary: async () => {
      authorityNow = new Date(expiresAtMs);
    },
  }).runProposal(payload("expired-at-final-boundary"));
  assert.equal(expiredAtFinalBoundary.decision, "blocked");
  assert.equal(expiredAtFinalBoundary.reason, "release_expired");
  assert.equal(
    expiredAtFinalBoundary.cloudPermitConsumptionState,
    "not_consumed",
  );
  assert.equal(expiredAtFinalBoundary.controllerGoalsAttempted, 0);
  assert.equal(expiredAtFinalBoundary.hardwareSignalSent, false);
  assert.equal(dispatches, 1);

  const assertTransientLocalWritePreservesBoundaryTruth = async (
    proposalId: string,
    expectedState: "consumed" | "unknown",
  ) => {
    consumeOutcomeUnknown = expectedState === "unknown";
    let writes = 0;
    let recoveredLocalResult: any;
    await assert.rejects(
      new CloudConnectedRos2Workflow({
        ...options,
        proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
        localEvidence: (result) => {
          writes += 1;
          if (writes === 1) throw new Error("local_result_write_transient");
          recoveredLocalResult = structuredClone(result);
        },
      }).runProposal(payload(proposalId)),
      /local_result_write_transient/,
    );
    assert.equal(writes, 2);
    assert.equal(
      recoveredLocalResult.cloudPermitConsumptionState,
      expectedState,
    );
    assert.equal(
      recoveredLocalResult.cloudPermitConsumed,
      expectedState === "consumed",
    );
    assert.equal(recoveredLocalResult.localPermitConsumed, true);
    assert.equal(
      recoveredLocalResult.controllerGoalsAttempted,
      expectedState === "consumed" ? 1 : 0,
    );
  };
  await assertTransientLocalWritePreservesBoundaryTruth(
    "transient-local-write-consumed",
    "consumed",
  );
  await assertTransientLocalWritePreservesBoundaryTruth(
    "transient-local-write-unknown",
    "unknown",
  );
  consumeOutcomeUnknown = false;

  const malformedControllerCases = [
    {
      proposalId: "controller-empty-detail",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        detail: "",
      },
      expectedReason: "controller_result_invalid:detail_empty",
      assertNormalized(result: any) {
        assert.equal(
          result.controllerResult.detail,
          "controller_response_detail_empty",
        );
      },
    },
    {
      proposalId: "controller-long-detail",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        detail: "d".repeat(501),
      },
      expectedReason: "controller_result_invalid:detail_too_long",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.detail.length, 500);
        assert.match(result.controllerResult.detail, /:truncated$/);
      },
    },
    {
      proposalId: "controller-fractional-status",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        status: 1.5,
        detail: "controller_reported_success",
      },
      expectedReason: "controller_result_invalid:status_not_integer",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.status, undefined);
      },
    },
    {
      proposalId: "controller-unsafe-status",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        status: Number.MAX_SAFE_INTEGER + 1,
        detail: "controller_reported_success",
      },
      expectedReason: "controller_result_invalid:status_not_integer",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.status, undefined);
      },
    },
    {
      proposalId: "controller-fractional-error-code",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        errorCode: 1.5,
        detail: "controller_reported_success",
      },
      expectedReason: "controller_result_invalid:error_code_not_integer",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.errorCode, undefined);
      },
    },
    {
      proposalId: "controller-long-error-string",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        errorString: "e".repeat(501),
        detail: "controller_reported_success",
      },
      expectedReason: "controller_result_invalid:error_string_too_long",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.errorString.length, 500);
        assert.match(result.controllerResult.errorString, /:truncated$/);
      },
    },
    {
      proposalId: "controller-invalid-unicode-detail",
      response: {
        accepted: true,
        completed: true,
        succeeded: true,
        detail: "invalid\ud800detail",
      },
      expectedReason: "controller_result_invalid:detail_invalid_unicode",
      assertNormalized(result: any) {
        assert.equal(result.controllerResult.detail, "invalid\ufffddetail");
      },
    },
  ];
  for (const malformed of malformedControllerCases) {
    controllerResponse = malformed.response;
    const consumptionCount: number = permitConsumptions;
    const dispatchCount: number = dispatches;
    const result = await new CloudConnectedRos2Workflow({
      ...options,
      proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
    }).runProposal(payload(malformed.proposalId));
    assert.equal(result.decision, "failed");
    assert.equal(result.reason, malformed.expectedReason);
    assert.ok(result.reason.length <= 500);
    assert.equal(result.hardwareSignalSent, true);
    assert.equal(result.controllerGoalsAttempted, 1);
    assert.equal(result.cloudPermitConsumptionState, "consumed");
    assert.equal(result.cloudPermitConsumed, true);
    assert.equal(result.localPermitConsumed, true);
    assert.equal(result.evidenceVerified, true);
    malformed.assertNormalized(result);
    assert.deepEqual(submitted.payload.controllerResult, result.controllerResult);
    assert.equal(submitEvidenceSchema.safeParse(submitted).success, true);
    assert.equal(permitConsumptions, consumptionCount + 1);
    assert.equal(dispatches, dispatchCount + 1);
  }

  controllerResponse = {
    accepted: false,
    completed: false,
    succeeded: false,
    detail: "r".repeat(500),
  };
  const boundedRejection = await new CloudConnectedRos2Workflow({
    ...options,
    proposalReplayRegistry: new InMemoryProposalReplayRegistry(),
  }).runProposal(payload("controller-bounded-rejection-reason"));
  assert.equal(boundedRejection.decision, "failed");
  assert.equal(boundedRejection.reason.length, 500);
  assert.match(boundedRejection.reason, /:truncated$/);
  assert.equal(boundedRejection.hardwareSignalSent, true);
  assert.equal(boundedRejection.cloudPermitConsumptionState, "consumed");
  assert.equal(
    submitEvidenceSchema.safeParse(submitted).success,
    true,
  );
});

test("initial revoked release denial writes Evidence and the first replay after restart blocks", async (t) => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  const replayRoot = mkdtempSync(join(tmpdir(), "rlsok-cloud-workflow-replay-"));
  t.after(() => rmSync(replayRoot, { recursive: true, force: true }));
  let submitted: any;
  const submissions: any[] = [];
  let releaseReads = 0;
  let stateReads = 0;
  let dispatches = 0;
  const createdAt = "2026-01-01T00:02:00.000Z";
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const cloud = {
    async getRelease() {
      releaseReads += 1;
      return {
        releaseId: spec.metadata.releaseId,
        contentHash: executablePolicyHash(spec),
        state: "revoked" as const,
      };
    },
    async requestPermit() {
      throw new Error("permit_must_not_be_requested");
    },
    async submitEvidence(value: any) {
      submitted = value;
      submissions.push(structuredClone(value));
      return {
        evidenceId,
        sequence: 0,
        previousHash: null,
        evidenceHash: sha256(canonicalJson(evidenceBodyFromSubmission(value, createdAt))),
        createdAt,
      };
    },
    async getEvidence() {
      const body = evidenceBodyFromSubmission(submitted, createdAt);
      return {
        id: evidenceId,
        ...body,
        evidenceHash: sha256(canonicalJson(body)),
      };
    },
  } as unknown as RlsokCloudClient;
  const transport = {
    async getFreshJointState() {
      stateReads += 1;
      throw new Error("state_must_not_be_read");
    },
    async dispatchTrajectory() {
      dispatches += 1;
      throw new Error("dispatch_must_not_happen");
    },
  } as unknown as Ros2ReferenceTransport;
  const localResults: any[] = [];
  const workflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    proposalReplayRegistry: new FileProposalReplayRegistry(replayRoot),
    localEvidence: (result) => {
      localResults.push(structuredClone(result));
    },
  });
  const payload = JSON.stringify({
    proposalId: "revoked-proposal-001",
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt,
  });
  const result = await workflow.runProposal(payload);
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "cloud_release_not_eligible:revoked");
  assert.equal(result.cloudPermitId, null);
  assert.equal(result.controllerGoalsAttempted, 0);
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(result.evidenceVerified, true);
  assert.equal(stateReads, 0);
  assert.equal(dispatches, 0);
  assert.equal(submitted.permitId, null);
  assert.equal(submitted.payload.evaluationMode, "denial");
  assert.equal(localResults.length, 2);

  const restartedWorkflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    proposalReplayRegistry: new FileProposalReplayRegistry(replayRoot),
    localEvidence: (replayResult) => {
      localResults.push(structuredClone(replayResult));
    },
  });
  const duplicate = await restartedWorkflow.runProposal(payload);
  assert.equal(duplicate.decision, "blocked");
  assert.equal(duplicate.reason, "proposal_id_duplicate");
  assert.equal(duplicate.cloudPermitId, null);
  assert.equal(duplicate.controllerGoalsAttempted, 0);
  assert.equal(duplicate.hardwareSignalSent, false);
  assert.equal(duplicate.evidenceVerified, true);
  assert.equal(releaseReads, 1);
  assert.equal(stateReads, 0);
  assert.equal(dispatches, 0);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].payload.reason, "proposal_id_duplicate");
  assert.equal(localResults.length, 4);
});

test("cloud proposal replay registry fails closed when its bounded capacity is exhausted", async () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  let submitted: any;
  let releaseReads = 0;
  const createdAt = "2026-01-01T00:02:00.000Z";
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const cloud = {
    async getRelease() {
      releaseReads += 1;
      return {
        releaseId: spec.metadata.releaseId,
        contentHash: executablePolicyHash(spec),
        state: "revoked" as const,
      };
    },
    async requestPermit() {
      throw new Error("permit_must_not_be_requested");
    },
    async submitEvidence(value: any) {
      submitted = value;
      return {
        evidenceId,
        sequence: 0,
        previousHash: null,
        evidenceHash: sha256(canonicalJson(evidenceBodyFromSubmission(value, createdAt))),
        createdAt,
      };
    },
    async getEvidence() {
      const body = evidenceBodyFromSubmission(submitted, createdAt);
      return { id: evidenceId, ...body, evidenceHash: sha256(canonicalJson(body)) };
    },
  } as unknown as RlsokCloudClient;
  const transport = {
    async getFreshJointState() {
      throw new Error("state_must_not_be_read");
    },
    async dispatchTrajectory() {
      throw new Error("dispatch_must_not_happen");
    },
  } as unknown as Ros2ReferenceTransport;
  const workflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    localEvidence: () => undefined,
    maximumProposalIds: 1,
  });
  const proposal = (proposalId: string) => JSON.stringify({
    proposalId,
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt,
  });
  assert.equal((await workflow.runProposal(proposal("first"))).reason, "cloud_release_not_eligible:revoked");
  const exhausted = await workflow.runProposal(proposal("second"));
  assert.equal(exhausted.decision, "blocked");
  assert.equal(exhausted.reason, "proposal_replay_registry_capacity_exceeded");
  assert.equal(exhausted.controllerGoalsAttempted, 0);
  assert.equal(exhausted.hardwareSignalSent, false);
  assert.equal(releaseReads, 1);

  const invalidRegistryWorkflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    localEvidence: () => undefined,
    proposalReplayRegistry: {
      claim: () => "unexpected" as never,
    },
  });
  const invalidClaim = await invalidRegistryWorkflow.runProposal(
    proposal("invalid-registry-result"),
  );
  assert.equal(invalidClaim.decision, "blocked");
  assert.equal(invalidClaim.reason, "proposal_replay_registry_unavailable");
  assert.equal(invalidClaim.controllerGoalsAttempted, 0);
  assert.equal(invalidClaim.hardwareSignalSent, false);
  assert.equal(releaseReads, 1);
  await assert.rejects(
    invalidRegistryWorkflow.runProposal(" ".repeat(65_537)),
    /proposal_payload_too_large/,
  );
});

test("cloud-connected release with capability requirements fails closed without attestation", async () => {
  const base = executablePolicySpecSchema.parse(fixture.execSpec);
  const spec = executablePolicySpecSchema.parse({
    ...base,
    runtimePolicy: {
      ...base.runtimePolicy,
      requiredCapabilities: ["controller.available"],
      maxAttestationAgeMs: 5_000,
    },
  });
  let submitted: any;
  let stateReads = 0;
  let permitRequests = 0;
  let dispatches = 0;
  const createdAt = new Date().toISOString();
  const evidenceId = "33333333-3333-4333-8333-333333333333";
  const cloud = {
    async getRelease() {
      return {
        releaseId: spec.metadata.releaseId,
        contentHash: executablePolicyHash(spec),
        state: "approved" as const,
      };
    },
    async requestPermit() {
      permitRequests += 1;
      throw new Error("permit_must_not_be_requested_without_attestation");
    },
    async submitEvidence(value: any) {
      submitted = value;
      return {
        evidenceId,
        sequence: 0,
        previousHash: null,
        evidenceHash: sha256(canonicalJson(evidenceBodyFromSubmission(value, createdAt))),
        createdAt,
      };
    },
    async getEvidence() {
      const body = evidenceBodyFromSubmission(submitted, createdAt);
      return {
        id: evidenceId,
        ...body,
        evidenceHash: sha256(canonicalJson(body)),
      };
    },
  } as unknown as RlsokCloudClient;
  const transport = {
    async getFreshJointState() {
      stateReads += 1;
      throw new Error("state_must_not_be_read_without_attestation");
    },
    async dispatchTrajectory() {
      dispatches += 1;
      throw new Error("dispatch_must_not_happen_without_attestation");
    },
  } as unknown as Ros2ReferenceTransport;
  const workflow = new CloudConnectedRos2Workflow({
    mode: "shadow",
    release: spec,
    cloud,
    transport,
    controllerIdentity: spec.robot.controllerConfigSha256,
    executionConfiguration: async () => currentExecutionConfiguration(),
    localEvidence: () => undefined,
  });
  const result = await workflow.runProposal(JSON.stringify({
    proposalId: "missing-runtime-attestation",
    releaseId: spec.metadata.releaseId,
    deviceId: spec.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt,
  }));
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "runtime_attestation_missing");
  assert.equal(result.hardwareSignalSent, false);
  assert.equal(result.evidenceVerified, true);
  assert.equal(stateReads, 0);
  assert.equal(permitRequests, 0);
  assert.equal(dispatches, 0);
});

test("expired and mode-mismatched local authority fail before Cloud or controller access", async () => {
  const base = executablePolicySpecSchema.parse(fixture.execSpec);
  let cloudReads = 0;
  let stateReads = 0;
  let dispatches = 0;
  const cloud = {
    async getRelease() {
      cloudReads += 1;
      throw new Error("cloud_must_not_be_read");
    },
  } as unknown as RlsokCloudClient;
  const transport = {
    async getFreshJointState() {
      stateReads += 1;
      throw new Error("state_must_not_be_read");
    },
    async dispatchTrajectory() {
      dispatches += 1;
      throw new Error("dispatch_must_not_happen");
    },
  } as unknown as Ros2ReferenceTransport;
  const payload = JSON.stringify({
    proposalId: "authority-negative-001",
    releaseId: base.metadata.releaseId,
    deviceId: base.deployment.allowedDeviceIds[0],
    proposerIdentity: "fixture-policy",
    actionRepresentation: "trajectory",
    actionPayload: fixture.action,
    createdAt: "2026-01-01T00:02:00.000Z",
  });
  const cases = [
    {
      expected: /release_expired/,
      mode: "shadow" as const,
      release: {
        ...base,
        deployment: {
          ...base.deployment,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    },
    {
      expected: /release_deployment_mode_mismatch/,
      mode: "run" as const,
      release: base,
    },
  ];
  for (const validationCase of cases) {
    const workflow = new CloudConnectedRos2Workflow({
      mode: validationCase.mode,
      release: executablePolicySpecSchema.parse(validationCase.release),
      cloud,
      transport,
      controllerIdentity: base.robot.controllerConfigSha256,
      executionConfiguration: async () => currentExecutionConfiguration(),
      localEvidence: () => undefined,
      proposalReplayRegistry: validationCase.mode === "run"
        ? new InMemoryProposalReplayRegistry()
        : undefined,
    });
    await assert.rejects(workflow.runProposal(payload), validationCase.expected);
  }
  assert.equal(cloudReads, 0);
  assert.equal(stateReads, 0);
  assert.equal(dispatches, 0);
});

function evidenceExport(count = 205): EvidenceExport {
  const organizationFingerprint = "a".repeat(64);
  const records: EvidenceExport["records"] = [];
  let previousHash: string | null = null;
  for (let sequence = 0; sequence < count; sequence += 1) {
    const body = {
      sequence,
      previousHash,
      releaseId: "fixture-release-001",
      permitId: null,
      decision: "blocked" as const,
      hardwareSignalSent: false,
      payload: {
        contractVersion: "rlsok-cloud/v1" as const,
        evaluationMode: "denial" as const,
        contentHash: fixture.expected.contentHash,
        actionHash: fixture.expected.actionHash,
        deviceId: "fixture-arm-01",
        controllerId: "1".repeat(64),
        expectedConfigurationDigest: configurationDigest,
        observedConfigurationDigest: configurationDigest,
        localPermitConsumed: false,
        cloudPermitConsumptionState: "not_consumed",
        controllerGoalsAttempted: 0,
        reason: `fixture-${sequence}`,
      },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    };
    const evidenceHash = sha256(canonicalJson(body));
    records.push({
      id: `${String(sequence).padStart(8, "0")}-0000-4000-8000-000000000000`,
      ...body,
      evidenceHash,
      organizationFingerprint,
      includedForReleaseFilter: true,
    });
    previousHash = evidenceHash;
  }
  return {
    apiVersion: "rlsok-cloud/v1",
    organizationFingerprint,
    releaseFilter: null,
    firstSequence: 0,
    lastSequence: count - 1,
    trustedCheckpoint: null,
    records,
  };
}

test("offline Evidence verifier validates more than 200 records and rejects chain attacks", () => {
  const complete = evidenceExport();
  assert.deepEqual(verifyEvidenceChain(complete), {
    ok: true,
    recordsVerified: 205,
  });

  const mutations: Array<[string, (value: EvidenceExport) => void]> = [
    ["missing", (value) => value.records.splice(100, 1)],
    [
      "payload",
      (value) => {
        value.records[100]!.payload.reason = "changed";
      },
    ],
    [
      "sequence",
      (value) => {
        value.records[100]!.sequence = 999;
      },
    ],
    [
      "previous",
      (value) => {
        value.records[100]!.previousHash = "f".repeat(64);
      },
    ],
    [
      "duplicate",
      (value) => {
        value.records[100]!.sequence = 99;
      },
    ],
    [
      "truncated",
      (value) => {
        value.records = value.records.slice(1);
      },
    ],
    [
      "organization",
      (value) => {
        value.records[100]!.organizationFingerprint = "b".repeat(64);
      },
    ],
    [
      "release-boundary",
      (value) => {
        value.releaseFilter = "fixture-release-001";
        value.records[100]!.releaseId = "other-release";
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(complete);
    mutate(changed);
    const result = verifyEvidenceChain(changed);
    assert.equal(result.ok, false, name);
  }
});

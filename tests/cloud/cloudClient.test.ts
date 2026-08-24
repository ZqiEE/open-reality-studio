import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CloudClientError,
  CloudConnectedDispatchBoundary,
  CloudConnectedRos2Workflow,
  RlsokCloudClient,
  executionMode,
  loadCloudClientConfig,
  verifyEvidenceChain,
  type EvidenceExport,
  readStoredCloudCredentials,
  writeStoredCloudCredentials,
} from "../../packages/cloud-client";
import type { Ros2ReferenceTransport } from "../../packages/ros2-reference-gateway";
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

test("cross-repository fixture uses the public strict schema and canonical hashes", () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  assert.equal(fixture.contractVersion, "rlsok-cloud/v1");
  assert.equal(executablePolicyHash(spec), fixture.expected.contentHash);
  assert.equal(
    sha256(canonicalJson(fixture.action)),
    fixture.expected.actionHash,
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

test("cloud dispatch boundary refreshes state and consumes exactly once before dispatch", async () => {
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
  assert.equal(await boundary.dispatch(fixture.action, {}), "accepted");
  assert.deepEqual(calls, [
    "GET:/v1/releases/fixture-release-001",
    `POST:/v1/permits/${permitId}/consume`,
    "controller:dispatch",
  ]);
  assert.equal(dispatches, 1);
  await assert.rejects(
    boundary.dispatch(fixture.action, {}),
    /boundary_reused/,
  );
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
  await assert.rejects(
    boundary.dispatch(fixture.action, {}),
    /cloud_release_not_currently_approved/,
  );
  assert.equal(calls, 1);
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
        evidenceHash: "0".repeat(64),
        createdAt,
      };
    },
    async getEvidence() {
      const body = {
        sequence: 0,
        previousHash: null,
        releaseId: submitted.releaseId,
        permitId: submitted.permitId,
        decision: submitted.decision,
        hardwareSignalSent: submitted.hardwareSignalSent,
        payload: submitted.payload,
        createdAt,
      };
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
});

test("initial revoked release denial writes and verifies Evidence without a Permit or dispatch", async () => {
  const spec = executablePolicySpecSchema.parse(fixture.execSpec);
  let submitted: any;
  let stateReads = 0;
  let dispatches = 0;
  const createdAt = "2026-01-01T00:02:00.000Z";
  const evidenceId = "22222222-2222-4222-8222-222222222222";
  const cloud = {
    async getRelease() {
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
        evidenceHash: "0".repeat(64),
        createdAt,
      };
    },
    async getEvidence() {
      const body = {
        sequence: 0,
        previousHash: null,
        releaseId: submitted.releaseId,
        permitId: submitted.permitId ?? null,
        decision: submitted.decision,
        hardwareSignalSent: submitted.hardwareSignalSent,
        payload: submitted.payload,
        createdAt,
      };
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
        evidenceHash: "0".repeat(64),
        createdAt,
      };
    },
    async getEvidence() {
      const body = {
        sequence: 0,
        previousHash: null,
        releaseId: submitted.releaseId,
        permitId: submitted.permitId ?? null,
        decision: submitted.decision,
        hardwareSignalSent: submitted.hardwareSignalSent,
        payload: submitted.payload,
        createdAt,
      };
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

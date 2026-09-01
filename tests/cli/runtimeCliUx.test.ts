import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  launchBrowser,
  type BrowserProcess,
  type BrowserSpawn,
} from "../../apps/cli/browser-launch";
import { hasHelpFlag } from "../../apps/cli/help-flag";
import {
  pairingFailureGuidance,
  pairUsage,
  runPairCommand,
  type PairCommandDependencies,
} from "../../apps/cli/pair";
import { ros2Usage, runRos2Command } from "../../apps/cli/ros2";
import {
  presentSetupApproval,
  runSetupCommand,
  setupUsage,
} from "../../apps/cli/setup";

async function captureStdout(action: () => Promise<number>): Promise<{
  exitCode: number;
  stdout: string;
}> {
  let stdout = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { exitCode: await action(), stdout };
  } finally {
    process.stdout.write = original;
  }
}

class FakeBrowserProcess extends EventEmitter {
  unrefCalled = false;

  unref(): void {
    this.unrefCalled = true;
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function startedPairing(): Record<string, unknown> {
  return {
    pairingId: "pairing-id",
    pairingToken: "SECRET-PAIRING-TOKEN",
    userCode: "SAFE-CODE",
    verificationUri: "https://example.invalid/pair",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function pairDependencies(
  fetchRequest: typeof fetch,
  overrides: PairCommandDependencies = {},
): PairCommandDependencies {
  return {
    fetchRequest,
    readCredentials: () => null,
    writeCredentials: () => "/protected/credentials.json",
    sleep: async () => undefined,
    now: () => 0,
    ...overrides,
  };
}

type PairingTerminal = "approved" | "auth" | "expired" | "network" | "revoked";

interface PairingProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

interface LoopbackPairingServer {
  baseUrl: string;
  close: () => Promise<void>;
  pollCount: () => number;
}

const PROCESS_PAIRING_TOKEN = `rlsok_${"T".repeat(43)}`;
const PROCESS_USER_CODE = "LOCAL-PAIR-CODE";

async function startLoopbackPairingServer(
  terminal: PairingTerminal,
): Promise<LoopbackPairingServer> {
  let polls = 0;
  let origin = "";
  const server = createServer((request, response) => {
    const sendJson = (status: number, body: Record<string, unknown>): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method === "POST" && request.url === "/v1/runtime-pairings") {
      sendJson(200, {
        pairingId: "local-pairing-id",
        pairingToken: PROCESS_PAIRING_TOKEN,
        userCode: PROCESS_USER_CODE,
        verificationUri: `${origin}/verify-runtime`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      return;
    }

    if (
      request.method === "GET" &&
      request.url === "/v1/runtime-pairings/local-pairing-id"
    ) {
      polls += 1;
      if (request.headers.authorization !== `Bearer ${PROCESS_PAIRING_TOKEN}`) {
        sendJson(403, { error: "test_auth_missing" });
        return;
      }
      if (terminal !== "approved" && polls === 1) {
        sendJson(200, { status: "pending" });
        return;
      }
      if (terminal === "network") {
        request.socket.destroy();
        return;
      }
      if (terminal === "auth") {
        sendJson(403, { error: "test_auth_rejected" });
        return;
      }
      sendJson(200, { status: terminal });
      return;
    }

    sendJson(404, { error: "test_route_not_found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl: origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
    },
    pollCount: () => polls,
  };
}

function processEnvironment(configRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LOCALAPPDATA: configRoot,
    XDG_CONFIG_HOME: configRoot,
  };
}

async function runPairingProcess(
  server: LoopbackPairingServer,
  options: {
    noBrowser?: boolean;
    unavailableBrowser?: boolean;
  } = {},
): Promise<{
  browserSpawnRecord: string;
  configRoot: string;
  result: PairingProcessResult;
  temporary: string;
}> {
  const temporary = mkdtempSync(join(tmpdir(), "rlsok-cli-process-"));
  const configRoot = join(temporary, "config");
  const browserSpawnRecord = join(temporary, "browser-spawn.jsonl");
  const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
  const spawnObserver = resolve(
    process.cwd(),
    "tests/cli/browser-spawn-observer.cjs",
  );
  const environment = processEnvironment(configRoot);
  environment.RLSOK_TEST_BROWSER_SPAWN_RECORD = browserSpawnRecord;

  if (options.unavailableBrowser) {
    environment.PATH = temporary;
    if (process.platform === "win32") {
      // Windows searches System32 independently of PATH. An invalid current-directory
      // executable proves the launch attempt fails before the real system opener.
      writeFileSync(join(temporary, "rundll32.exe"), "not-an-executable\n");
    } else {
      chmodSync(temporary, 0o700);
    }
  }

  const args = [
    "--require",
    spawnObserver,
    cli,
    "pair",
    "--cloud",
    server.baseUrl,
  ];
  if (options.noBrowser) args.push("--no-browser");

  let result: PairingProcessResult;
  try {
    result = await new Promise<PairingProcessResult>(
      (resolveResult, reject) => {
        const child = spawn(process.execPath, args, {
          cwd: temporary,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error("real CLI pairing process timed out"));
        }, 20_000);
        child.once("close", (status, signal) => {
          clearTimeout(timeout);
          resolveResult({ status, signal, stderr, stdout });
        });
      },
    );
  } catch (error) {
    removeProcessFixture(temporary);
    throw error;
  }

  return { browserSpawnRecord, configRoot, result, temporary };
}

function browserSpawnCount(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length;
}

function removeProcessFixture(temporary: string): void {
  rmSync(temporary, { force: true, recursive: true });
}

async function exercisePairingProcess(
  terminal: PairingTerminal,
  options: {
    noBrowser?: boolean;
    unavailableBrowser?: boolean;
  } = {},
): Promise<{
  browserSpawns: number;
  credentialsStored: boolean;
  polls: number;
  result: PairingProcessResult;
}> {
  const server = await startLoopbackPairingServer(terminal);
  let fixture: Awaited<ReturnType<typeof runPairingProcess>> | undefined;
  try {
    fixture = await runPairingProcess(server, options);
    return {
      browserSpawns: browserSpawnCount(fixture.browserSpawnRecord),
      credentialsStored: existsSync(
        join(fixture.configRoot, "rlsok", "cloud-credentials.json"),
      ),
      polls: server.pollCount(),
      result: fixture.result,
    };
  } finally {
    await server.close();
    if (fixture) removeProcessFixture(fixture.temporary);
  }
}

test("help preflight returns exact ROS 2 usage before operation parsing or release I/O", async () => {
  for (const args of [
    ["--help"],
    ["doctor", "--help"],
    ["doctor", "-h"],
    ["inspect", "Z:\\missing-release.yaml", "--help"],
    ["inspect", "Z:\\missing-release.yaml", "-h"],
    ["run", "--release", "secret-value", "-h"],
  ]) {
    const result = await captureStdout(() => runRos2Command(args));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `${ros2Usage()}\n`);
  }
});

test("built CLI help exits zero with exact stdout and empty stderr", () => {
  const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
  for (const args of [
    ["ros2", "--help"],
    ["ros2", "doctor", "-h"],
    ["ros2", "inspect", "Z:\\missing-release.yaml", "--help"],
    ["pair", "--help"],
    ["setup", "-h"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^usage:|^RLSOK/m);
  }
});

test("pair and setup help preflight before credential, platform, or discovery work", async () => {
  const pair = await captureStdout(() =>
    runPairCommand(["--cloud", "not-a-url", "--help"]),
  );
  assert.deepEqual(pair, { exitCode: 0, stdout: `${pairUsage()}\n` });

  const setup = await captureStdout(() =>
    runSetupCommand(["--artifact", "policy.bin", "--help"]),
  );
  assert.deepEqual(setup, { exitCode: 0, stdout: `${setupUsage()}\n` });
});

test("help flags used as required option values are not reinterpreted", () => {
  assert.equal(hasHelpFlag(["--cloud", "--help"], new Set(["--cloud"])), false);
  assert.equal(
    hasHelpFlag(["--artifact", "--help"], new Set(["--artifact"])),
    false,
  );
  assert.equal(
    hasHelpFlag(["doctor", "--python", "--help"], new Set(["--python"])),
    false,
  );
});

test("browser launcher reports synchronous spawn failure without leaking the URL", () => {
  const messages: string[] = [];
  assert.doesNotThrow(() =>
    launchBrowser("https://example.invalid/?token=SECRET", {
      platform: "linux",
      spawnProcess: () => {
        throw new Error("sync spawn failure SECRET");
      },
      writeError: (message) => messages.push(message),
    }),
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /Browser launch unavailable/);
  assert.doesNotMatch(messages[0]!, /SECRET|example\.invalid|token=/);
});

test("browser launcher uses native commands, unrefs, and stays silent on exit zero", () => {
  const cases: Array<{
    platform: NodeJS.Platform;
    command: string;
    prefix: string[];
  }> = [
    { platform: "linux", command: "xdg-open", prefix: [] },
    { platform: "darwin", command: "open", prefix: [] },
    {
      platform: "win32",
      command: "rundll32.exe",
      prefix: ["url.dll,FileProtocolHandler"],
    },
  ];
  for (const item of cases) {
    const child = new FakeBrowserProcess();
    const messages: string[] = [];
    let invocation: { command: string; args: string[] } | undefined;
    launchBrowser("https://example.invalid/manual", {
      platform: item.platform,
      spawnProcess: (command, args) => {
        invocation = { command, args };
        return child as unknown as BrowserProcess;
      },
      writeError: (message) => messages.push(message),
    });
    child.emit("exit", 0);
    assert.deepEqual(invocation, {
      command: item.command,
      args: [...item.prefix, "https://example.invalid/manual"],
    });
    assert.equal(child.unrefCalled, true);
    assert.deepEqual(messages, []);
  }
});

test("asynchronous browser spawn errors print one sanitized manual fallback", () => {
  const child = new FakeBrowserProcess();
  const messages: string[] = [];
  const secretUrl =
    "https://example.invalid/pair?code=SECRET-CODE&token=SECRET-TOKEN";
  const spawnProcess: BrowserSpawn = () => child as unknown as BrowserProcess;
  launchBrowser(secretUrl, {
    platform: "linux",
    spawnProcess,
    writeError: (message) => messages.push(message),
  });

  child.emit("error", new Error(`spawn xdg-open ENOENT ${secretUrl}`));
  child.emit("exit", 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /Browser launch unavailable/);
  assert.match(messages[0]!, /URL printed above/);
  assert.doesNotMatch(messages[0]!, /SECRET|example\.invalid|token=/);
});

test("nonzero browser exit prints one sanitized fallback and does not throw", () => {
  const child = new FakeBrowserProcess();
  const messages: string[] = [];
  launchBrowser("https://example.invalid/approval?token=SECRET", {
    platform: "darwin",
    spawnProcess: () => child as unknown as BrowserProcess,
    writeError: (message) => messages.push(message),
  });

  child.emit("exit", 3);
  child.emit("error", new Error("late error containing SECRET"));
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /did not open successfully/);
  assert.doesNotMatch(messages[0]!, /SECRET|example\.invalid|token=/);
});

test("unsupported platforms use the manual path without spawning", () => {
  const messages: string[] = [];
  let spawned = false;
  launchBrowser("https://example.invalid/pair?code=SECRET", {
    platform: "aix",
    spawnProcess: () => {
      spawned = true;
      return new FakeBrowserProcess() as unknown as BrowserProcess;
    },
    writeError: (message) => messages.push(message),
  });

  assert.equal(spawned, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /unsupported on this platform/);
  assert.doesNotMatch(messages[0]!, /SECRET|example\.invalid|code=/);
});

test("browser failure preserves printed pairing instructions and polling order", async () => {
  const events: string[] = [];
  const warnings: string[] = [];
  const child = new FakeBrowserProcess();
  let request = 0;
  const fetchRequest = (async () => {
    request += 1;
    events.push(request === 1 ? "start" : "poll");
    if (request === 1) return response(startedPairing());
    if (request === 2) return response({ status: "pending" });
    return response({ status: "approved" });
  }) as typeof fetch;
  const result = await captureStdout(() =>
    runPairCommand(
      ["--cloud", "https://api.example.invalid"],
      pairDependencies(fetchRequest, {
        launchBrowser: (url) => {
          events.push("browser");
          launchBrowser(url, {
            platform: "linux",
            spawnProcess: () => child as unknown as BrowserProcess,
            writeError: (message) => warnings.push(message),
          });
          child.emit("error", new Error(`ENOENT ${url} SECRET-PAIRING-TOKEN`));
        },
      }),
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ["start", "browser", "poll", "poll"]);
  assert.match(result.stdout, /Pairing code: SAFE-CODE/);
  assert.match(
    result.stdout,
    /Open: https:\/\/example\.invalid\/pair\?code=SAFE-CODE/,
  );
  assert.match(result.stdout, /Waiting for approval/);
  assert.doesNotMatch(result.stdout, /SECRET-PAIRING-TOKEN/);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0]!, /SECRET|example\.invalid/);
});

test("--no-browser and setup manual approval paths perform zero launches", async () => {
  let pairLaunches = 0;
  let request = 0;
  const fetchRequest = (async () => {
    request += 1;
    return response(request === 1 ? startedPairing() : { status: "approved" });
  }) as typeof fetch;
  const pair = await captureStdout(() =>
    runPairCommand(
      ["--cloud", "https://api.example.invalid", "--no-browser"],
      pairDependencies(fetchRequest, {
        launchBrowser: () => {
          pairLaunches += 1;
        },
      }),
    ),
  );
  assert.equal(pair.exitCode, 0);
  assert.equal(pairLaunches, 0);
  assert.match(pair.stdout, /Open:/);

  let setupLaunches = 0;
  const setup = await captureStdout(async () => {
    presentSetupApproval("https://example.invalid/approval", true, () => {
      setupLaunches += 1;
    });
    return 0;
  });
  assert.equal(setupLaunches, 0);
  assert.equal(setup.stdout, "  Approval: https://example.invalid/approval\n");

  let stdoutAtLaunch = "";
  let currentStdout = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    currentStdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    presentSetupApproval("https://example.invalid/approval", false, () => {
      stdoutAtLaunch = currentStdout;
    });
  } finally {
    process.stdout.write = original;
  }
  assert.equal(
    stdoutAtLaunch,
    "  Approval: https://example.invalid/approval\n",
  );
});

test("real CLI process pairs only after explicit loopback approval and preserves headless fallback", async () => {
  const [headless, unavailableBrowser] = await Promise.all([
    exercisePairingProcess("approved", { noBrowser: true }),
    exercisePairingProcess("approved", { unavailableBrowser: true }),
  ]);

  for (const scenario of [headless, unavailableBrowser]) {
    assert.equal(scenario.result.status, 0, scenario.result.stderr);
    assert.equal(scenario.result.signal, null);
    assert.equal(scenario.polls, 1);
    assert.equal(scenario.credentialsStored, true);
    assert.match(scenario.result.stdout, /Pairing code: LOCAL-PAIR-CODE/);
    assert.match(
      scenario.result.stdout,
      /Open: http:\/\/127\.0\.0\.1:\d+\/verify-runtime\?code=LOCAL-PAIR-CODE/,
    );
    assert.match(scenario.result.stdout, /Waiting for approval/);
    assert.match(
      scenario.result.stdout,
      /Paired with Hosted RLSOK Cloud\. Credentials stored at/,
    );
    assert.doesNotMatch(
      `${scenario.result.stdout}\n${scenario.result.stderr}`,
      new RegExp(PROCESS_PAIRING_TOKEN),
    );
    assert.doesNotMatch(
      scenario.result.stdout,
      /signed[ -]?in|sign[ -]?in (?:complete|succeeded|successful)/i,
    );
  }

  assert.equal(headless.browserSpawns, 0);
  assert.equal(headless.result.stderr, "");

  assert.equal(unavailableBrowser.browserSpawns, 1);
  assert.match(
    unavailableBrowser.result.stderr,
    /Browser launch unavailable\. Continue manually with the URL printed above/,
  );
  assert.doesNotMatch(
    unavailableBrowser.result.stderr,
    /LOCAL-PAIR-CODE|127\.0\.0\.1|verify-runtime|token|rlsok_T/i,
  );
});

test("real CLI process keeps pending terminal failures nonzero and never invents success", async () => {
  const terminals = ["expired", "revoked", "auth", "network"] as const;
  const scenarios = await Promise.all(
    terminals.map(async (terminal) => ({
      terminal,
      outcome: await exercisePairingProcess(terminal, { noBrowser: true }),
    })),
  );

  const expectedGuidance: Record<(typeof terminals)[number], RegExp> = {
    auth: /Hosted RLSOK Cloud rejected the pairing request/,
    expired: /Cloud pairing expired before approval/,
    network: /Could not reach Hosted RLSOK Cloud/,
    revoked: /Cloud pairing was revoked/,
  };
  for (const { terminal, outcome } of scenarios) {
    assert.equal(
      outcome.result.status,
      2,
      `${terminal}\n${outcome.result.stderr}`,
    );
    assert.equal(outcome.result.signal, null);
    assert(outcome.polls >= 2, `${terminal} did not pass through pending`);
    assert.equal(outcome.credentialsStored, false);
    assert.equal(outcome.browserSpawns, 0);
    assert.match(outcome.result.stdout, /Waiting for approval/);
    assert.doesNotMatch(
      outcome.result.stdout,
      /Paired with Hosted RLSOK Cloud|signed[ -]?in|sign[ -]?in (?:complete|succeeded|successful)/i,
    );
    assert.match(outcome.result.stderr, expectedGuidance[terminal]);
    assert.doesNotMatch(
      `${outcome.result.stdout}\n${outcome.result.stderr}`,
      new RegExp(PROCESS_PAIRING_TOKEN),
    );
    assert.doesNotMatch(
      outcome.result.stderr,
      /test_auth_rejected|authorization|Bearer|rlsok_T/i,
    );
  }
});

test("pair transport and server outcomes use stable safe classifications", async () => {
  const cases: Array<{
    name: string;
    fetchRequest: typeof fetch;
    code: string;
  }> = [
    {
      name: "network",
      fetchRequest: (async () => {
        throw new Error("DNS failed SECRET-PAIRING-TOKEN");
      }) as typeof fetch,
      code: "pairing_network_failed",
    },
    {
      name: "auth",
      fetchRequest: (async () =>
        response({ error: "SECRET" }, 401)) as typeof fetch,
      code: "pairing_auth_failed",
    },
    {
      name: "invalid JSON",
      fetchRequest: (async () =>
        new Response("SECRET not json")) as typeof fetch,
      code: "pairing_response_invalid",
    },
    {
      name: "server",
      fetchRequest: (async () =>
        response({ error: "SECRET" }, 503)) as typeof fetch,
      code: "pairing_server_failed",
    },
  ];
  for (const item of cases) {
    await assert.rejects(
      captureStdout(() =>
        runPairCommand(
          ["--cloud", "https://api.example.invalid", "--no-browser"],
          pairDependencies(item.fetchRequest),
        ),
      ),
      { message: item.code },
      item.name,
    );
    assert(pairingFailureGuidance[item.code]);
    assert.doesNotMatch(
      pairingFailureGuidance[item.code]!,
      /SECRET|token=|authorization|Bearer/i,
    );
  }
});

test("pair polling distinguishes auth, expiry, revocation, and invalid status", async () => {
  for (const item of [
    { result: response({ error: "hidden" }, 403), code: "pairing_auth_failed" },
    { result: response({ status: "expired" }), code: "pairing_expired" },
    { result: response({ status: "revoked" }), code: "pairing_revoked" },
    {
      result: response({ status: "mystery" }),
      code: "pairing_response_invalid",
    },
  ]) {
    let request = 0;
    const fetchRequest = (async () => {
      request += 1;
      return request === 1 ? response(startedPairing()) : item.result;
    }) as typeof fetch;
    await assert.rejects(
      captureStdout(() =>
        runPairCommand(
          ["--cloud", "https://api.example.invalid", "--no-browser"],
          pairDependencies(fetchRequest),
        ),
      ),
      { message: item.code },
    );
  }
});

test("unsupported JSON and unknown CLI options exit two without stdout", () => {
  const cli = resolve(__dirname, "../../apps/cli/rlsok.js");
  for (const item of [
    { args: ["setup", "--json"], message: /not supported/ },
    { args: ["setup", "--unknown", "value"], message: /Unknown option/ },
    { args: ["pair", "--unknown"], message: /usage: rlsok pair/ },
    {
      args: ["ros2", "doctor", "--unknown"],
      message: /expected --option value/,
    },
  ]) {
    const { args } = item;
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, RLSOK_SETUP_ACCEPTANCE: "1" },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, item.message);
    assert.doesNotMatch(result.stderr, /SECRET|apiKey|pairingToken/);
  }
});

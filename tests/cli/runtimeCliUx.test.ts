import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
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
  assert.match(result.stdout, /Open: https:\/\/example\.invalid\/pair\?code=SAFE-CODE/);
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

test("pair transport and server outcomes use stable safe classifications", async () => {
  const cases: Array<{ name: string; fetchRequest: typeof fetch; code: string }> = [
    {
      name: "network",
      fetchRequest: (async () => {
        throw new Error("DNS failed SECRET-PAIRING-TOKEN");
      }) as typeof fetch,
      code: "pairing_network_failed",
    },
    {
      name: "auth",
      fetchRequest: (async () => response({ error: "SECRET" }, 401)) as typeof fetch,
      code: "pairing_auth_failed",
    },
    {
      name: "invalid JSON",
      fetchRequest: (async () => new Response("SECRET not json")) as typeof fetch,
      code: "pairing_response_invalid",
    },
    {
      name: "server",
      fetchRequest: (async () => response({ error: "SECRET" }, 503)) as typeof fetch,
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
    { result: response({ status: "mystery" }), code: "pairing_response_invalid" },
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
    { args: ["ros2", "doctor", "--unknown"], message: /expected --option value/ },
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

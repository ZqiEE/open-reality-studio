import { hostname } from "node:os";
import {
  readStoredCloudCredentials,
  writeStoredCloudCredentials,
} from "../../packages/cloud-client/credentials";
import { launchBrowser } from "./browser-launch";
import { hasHelpFlag } from "./help-flag";

const DEFAULT_CLOUD = "https://api.rlsok.com";
const PAIRING_ERROR_CODES = new Set([
  "pairing_auth_failed",
  "pairing_expired",
  "pairing_network_failed",
  "pairing_response_invalid",
  "pairing_revoked",
  "pairing_server_failed",
]);

export const pairingFailureGuidance: Readonly<Record<string, string>> = {
  pairing_expired:
    "Cloud pairing expired before approval. Run 'rlsok pair' again and approve the new code within 10 minutes.",
  pairing_revoked:
    "Cloud pairing was revoked. Run 'rlsok pair' again and ask a Workspace administrator to approve the new code.",
  pairing_network_failed:
    "Could not reach Hosted RLSOK Cloud. Check DNS, network access, TLS inspection, and the configured --cloud endpoint, then retry.",
  pairing_auth_failed:
    "Hosted RLSOK Cloud rejected the pairing request or pairing credential. Verify the trusted --cloud endpoint, then start a new pairing.",
  pairing_response_invalid:
    "Hosted RLSOK Cloud returned an invalid pairing response. Retry against the trusted --cloud endpoint; if it persists, contact support.",
  pairing_server_failed:
    "Hosted RLSOK Cloud could not complete pairing. Retry later against the trusted --cloud endpoint; if it persists, contact support.",
};

export interface PairCommandDependencies {
  fetchRequest?: typeof fetch;
  launchBrowser?: (url: string) => void;
  readCredentials?: typeof readStoredCloudCredentials;
  writeCredentials?: typeof writeStoredCloudCredentials;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export function pairUsage(): string {
  return [
    "usage: rlsok pair [--cloud https://api.rlsok.com] [--no-browser] [--replace]",
    "",
    "Pair this robot-side runtime with Hosted RLSOK Cloud. Approval remains a",
    "separate action performed by an authenticated Workspace administrator.",
    "The code and URL are always printed. Use --no-browser on headless/SSH systems.",
  ].join("\n");
}

function pairingError(code: string): Error {
  return new Error(code);
}

async function requestJson(
  fetchRequest: typeof fetch,
  url: string,
  init: RequestInit,
  phase: "start" | "poll",
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchRequest(url, init);
  } catch {
    throw pairingError("pairing_network_failed");
  }

  let body: Record<string, unknown>;
  try {
    const value = (await response.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw pairingError("pairing_response_invalid");
    }
    body = value as Record<string, unknown>;
  } catch (error) {
    if (response.status === 401 || response.status === 403) {
      throw pairingError("pairing_auth_failed");
    }
    if (
      phase === "poll" &&
      (response.status === 404 || response.status === 410)
    ) {
      throw pairingError("pairing_expired");
    }
    if (error instanceof Error && PAIRING_ERROR_CODES.has(error.message)) {
      throw error;
    }
    throw pairingError("pairing_response_invalid");
  }

  if (response.ok) return body;
  if (response.status === 401 || response.status === 403) {
    throw pairingError("pairing_auth_failed");
  }
  if (body.error === "pairing_expired" || body.error === "pairing_revoked") {
    throw pairingError(body.error);
  }
  if (phase === "poll" && (response.status === 404 || response.status === 410)) {
    throw pairingError("pairing_expired");
  }
  throw pairingError("pairing_server_failed");
}

export async function runPairCommand(
  args: string[],
  dependencies: PairCommandDependencies = {},
): Promise<number> {
  if (hasHelpFlag(args, new Set(["--cloud"]))) {
    process.stdout.write(`${pairUsage()}\n`);
    return 0;
  }
  const fetchRequest = dependencies.fetchRequest ?? fetch;
  const openBrowser = dependencies.launchBrowser ?? launchBrowser;
  const readCredentials =
    dependencies.readCredentials ?? readStoredCloudCredentials;
  const writeCredentials =
    dependencies.writeCredentials ?? writeStoredCloudCredentials;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;

  let apiUrl = DEFAULT_CLOUD;
  let shouldLaunchBrowser = true;
  let replaceExisting = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cloud" && args[index + 1]) apiUrl = args[++index]!;
    else if (args[index] === "--no-browser") shouldLaunchBrowser = false;
    else if (args[index] === "--replace") replaceExisting = true;
    else throw new Error(pairUsage().split("\n", 1)[0]);
  }
  const existing = readCredentials();
  if (existing && !replaceExisting)
    throw new Error("runtime_already_paired_use_--replace");
  const parsedUrl = new URL(apiUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname);
  if (
    parsedUrl.protocol !== "https:" &&
    !(local && parsedUrl.protocol === "http:")
  )
    throw new Error("pairing_cloud_url_requires_https_except_loopback");
  const baseUrl = apiUrl.replace(/\/$/, "");
  const started = await requestJson(
    fetchRequest,
    `${baseUrl}/v1/runtime-pairings`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceLabel: hostname().slice(0, 120) || "local-runtime",
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
    "start",
  );
  const { pairingId, pairingToken, userCode, verificationUri } = started;
  if (
    ![pairingId, pairingToken, userCode, verificationUri].every(
      (value) => typeof value === "string",
    )
  )
    throw pairingError("pairing_response_invalid");
  let browserUrl: URL;
  try {
    browserUrl = new URL(verificationUri as string);
  } catch {
    throw pairingError("pairing_response_invalid");
  }
  browserUrl.searchParams.set("code", userCode as string);
  process.stdout.write(
    `Pairing code: ${userCode}\nOpen: ${browserUrl}\nWaiting for approval...\n`,
  );
  if (shouldLaunchBrowser) openBrowser(browserUrl.toString());
  const expiresAt = Date.parse(String(started.expiresAt));
  if (!Number.isFinite(expiresAt))
    throw pairingError("pairing_response_invalid");
  while (now() < expiresAt) {
    await sleep(3_000);
    const status = await requestJson(
      fetchRequest,
      `${baseUrl}/v1/runtime-pairings/${encodeURIComponent(pairingId as string)}`,
      {
        headers: { authorization: `Bearer ${pairingToken}` },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
      "poll",
    );
    if (status.status === "approved") {
      const path = writeCredentials({
        apiUrl: baseUrl,
        apiKey: pairingToken as string,
      });
      process.stdout.write(
        `Paired with Hosted RLSOK Cloud. Credentials stored at ${path}.\n`,
      );
      if (existing)
        process.stdout.write(
          "The previous runtime credential remains active until an administrator revokes it in Dashboard > Operations.\n",
        );
      return 0;
    }
    if (status.status === "revoked") throw pairingError("pairing_revoked");
    if (status.status === "expired") break;
    if (status.status !== "pending")
      throw pairingError("pairing_response_invalid");
  }
  throw pairingError("pairing_expired");
}

#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
};

async function json(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`request_failed:${response.status}:${url}`);
  return body;
}

export function assertCloudProof({
  health,
  readiness,
  manifest,
  deployment,
  candidateSource,
  candidateTag,
}) {
  if (health?.status !== "ok") throw new Error("cloud_health_not_ok");
  if (readiness?.status !== "ready") throw new Error("cloud_not_ready");
  if (readiness?.executionPolicy !== "shadow-only") {
    throw new Error("cloud_not_shadow_only");
  }
  const activeRuntimeAccepted =
    manifest?.runtimeSourceCommit === candidateSource &&
    manifest?.releaseTag === candidateTag;
  const candidateRuntimeAccepted = Array.isArray(manifest?.runtimeCandidates) &&
    manifest.runtimeCandidates.some((candidate) =>
      candidate?.sourceCommit === candidateSource &&
      candidate?.releaseTag === candidateTag
    );
  if (!activeRuntimeAccepted && !candidateRuntimeAccepted) {
    throw new Error("cloud_rejects_runtime_candidate");
  }
  if (!/^[0-9a-f]{40}$/.test(manifest?.minimumCloudSourceCommit ?? "")) {
    throw new Error("cloud_minimum_source_missing");
  }
  if (!/^[0-9a-f]{40}$/.test(deployment?.sourceCommit ?? "")) {
    throw new Error("live_cloud_source_missing");
  }
  if (readiness?.sourceCommit !== deployment.sourceCommit) {
    throw new Error("cloud_api_site_source_mismatch");
  }
  if (deployment?.cloudVersion !== manifest?.cloudVersion) {
    throw new Error("live_cloud_version_mismatch");
  }
  return {
    minimumCloudSourceCommit: manifest.minimumCloudSourceCommit,
    liveCloudSourceCommit: deployment.sourceCommit,
  };
}

export function assertMinimumCommit(compare) {
  if (!new Set(["ahead", "identical"]).has(compare?.status)) {
    throw new Error("live_cloud_source_before_minimum");
  }
}

async function main() {
  const cloudOrigin = process.env.RLSOK_CLOUD_ORIGIN ?? "https://rlsok.com";
  const apiOrigin = process.env.RLSOK_API_ORIGIN ?? "https://api.rlsok.com";
  const candidateSource = required("RLSOK_RUNTIME_SOURCE_SHA");
  const candidateTag = required("RLSOK_RUNTIME_TAG");
  const organization = required("RLSOK_CLOUD_ORGANIZATION");
  const email = required("RLSOK_CLOUD_EMAIL");
  const password = required("RLSOK_CLOUD_PASSWORD");
  const health = await json(`${apiOrigin}/healthz`);
  const login = await json(`${apiOrigin}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization, email, password }),
  });
  const authorization = `Bearer ${login.token}`;
  let readiness;
  try {
    readiness = await json(`${apiOrigin}/readyz`, {
      headers: { authorization },
    });
  } finally {
    await fetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: { authorization },
    }).catch(() => undefined);
  }
  const [manifest, deployment] = await Promise.all([
    json(`${cloudOrigin}/release.json`, { cache: "no-store" }),
    json(`${cloudOrigin}/deployment.json`, { cache: "no-store" }),
  ]);
  const proof = assertCloudProof({
    health,
    readiness,
    manifest,
    deployment,
    candidateSource,
    candidateTag,
  });
  const githubToken = required("GH_TOKEN");
  const compare = await json(
    `https://api.github.com/repos/realitywarden/rlsok-cloud/compare/${proof.minimumCloudSourceCommit}...${proof.liveCloudSourceCommit}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "rlsok-cloud-rollout-gate",
      },
    },
  );
  assertMinimumCommit(compare);
  process.stdout.write(JSON.stringify({
    cloudHealth: "ok",
    readiness: "ready",
    executionPolicy: "shadow-only",
    runtimeSourceAccepted: candidateSource,
    runtimeTagAccepted: candidateTag,
    ...proof,
  }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

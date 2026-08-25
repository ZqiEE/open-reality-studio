#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const apiVersion = "2026-03-10";

export function assertImmutablePolicy(value) {
  if (value?.enabled !== true) {
    throw new Error("github_immutable_releases_not_enabled");
  }
  return value;
}

export function assertPublishedImmutable(value, tag) {
  if (value?.tag_name !== tag) throw new Error("release_tag_mismatch");
  if (value?.draft === true) throw new Error("release_still_draft");
  if (value?.immutable !== true) throw new Error("published_release_not_immutable");
  return value;
}

async function github(path) {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GH_REPO;
  if (!token) throw new Error("GH_TOKEN_required");
  if (!repository) throw new Error("GH_REPO_required");
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": apiVersion,
      "user-agent": "rlsok-release-platform-gate",
    },
  });
  if (!response.ok) throw new Error(`github_api_${response.status}:${path}`);
  return response.json();
}

async function main() {
  const [mode, tag] = process.argv.slice(2);
  if (mode === "policy") {
    assertImmutablePolicy(await github("/immutable-releases"));
    process.stdout.write("immutable_release_policy=enabled\n");
    return;
  }
  if (mode === "published" && tag) {
    assertPublishedImmutable(
      await github(`/releases/tags/${encodeURIComponent(tag)}`),
      tag,
    );
    process.stdout.write(`published_release_immutable=${tag}\n`);
    return;
  }
  throw new Error("usage: release-platform-gates.mjs policy|published <tag>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

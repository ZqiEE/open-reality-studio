"use strict";

function assertCleanGitStatus(status) {
  if (typeof status !== "string" || status.trim().length !== 0) {
    throw new Error("package_source_worktree_dirty");
  }
}

module.exports = { assertCleanGitStatus };

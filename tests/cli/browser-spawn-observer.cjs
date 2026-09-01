"use strict";

const childProcess = require("node:child_process");
const { appendFileSync } = require("node:fs");

const originalSpawn = childProcess.spawn;
childProcess.spawn = function observedSpawn(command, args, options) {
  const recordPath = process.env.RLSOK_TEST_BROWSER_SPAWN_RECORD;
  if (recordPath) {
    appendFileSync(recordPath, `${JSON.stringify({ command })}\n`, "utf8");
  }
  return originalSpawn.call(this, command, args, options);
};

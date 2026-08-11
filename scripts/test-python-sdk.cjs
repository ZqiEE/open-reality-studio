const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const sdk = resolve(__dirname, "..", "sdk", "python");
const separator = process.platform === "win32" ? ";" : ":";
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", resolve(sdk, "tests"), "-v"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONPATH: [sdk, process.env.PYTHONPATH].filter(Boolean).join(separator),
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

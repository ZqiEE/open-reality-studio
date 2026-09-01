import { existsSync } from "node:fs";
import {
  FileProposalReplayRegistry,
  type ProposalReplayIdentity,
} from "../../packages/cloud-client";

const [directory, startFile, encodedIdentity, encodedMaximumClaims] = process.argv.slice(2);
if (!directory || !startFile || !encodedIdentity || !encodedMaximumClaims) process.exit(2);
const deadline = Date.now() + 10_000;
while (!existsSync(startFile)) {
  if (Date.now() >= deadline) process.exit(3);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}
const identity = JSON.parse(encodedIdentity) as ProposalReplayIdentity;
const maximumClaims = Number(encodedMaximumClaims);
process.stdout.write(
  `${new FileProposalReplayRegistry(directory, maximumClaims).claim(identity)}\n`,
);

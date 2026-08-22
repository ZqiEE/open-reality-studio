export default {
  mutate: [
    "packages/core/release-policy.ts:14-103",
    "packages/core/execution-gate.ts:175-414",
    "packages/core/runtime-attestation.ts",
    "packages/core/execution-configuration.ts:197-307",
    "packages/core/exec-spec.ts:117-125",
    "packages/core/exec-spec.ts:163-187",
  ],
  mutator: {
    // Labels and Evidence rule-id strings are asserted by conformance tests but are
    // not decision predicates. Mutation scope stays on executable conditions.
    excludedMutations: ["StringLiteral", "ArrayDeclaration"],
  },
  testRunner: "command",
  commandRunner: {
    command: "npm run test:releasegate && npm run test:decision-conformance",
  },
  coverageAnalysis: "off",
  concurrency: 4,
  timeoutMS: 15000,
  reporters: ["clear-text", "json", "html"],
  jsonReporter: { fileName: "artifacts/mutation/runtime.json" },
  htmlReporter: { fileName: "artifacts/mutation/runtime.html" },
  thresholds: { high: 100, low: 100, break: 100 },
};

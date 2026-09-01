import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line) as { id?: unknown; operation?: unknown };
  if (typeof request.id !== "number" || request.operation !== "ping") return;
  process.stdout.write(
    `${JSON.stringify({ id: request.id, ok: true, result: {} })}\n` +
      `${JSON.stringify({ id: request.id + 10_000, ok: true, result: {} })}\n`,
  );
});

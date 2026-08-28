import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line) as { id?: unknown; operation?: unknown };
  if (typeof request.id !== "number") return;
  if (request.operation === "ping") {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, ok: true, result: {} })}\n`,
    );
    return;
  }
  if (request.operation === "doctor") {
    process.stdout.write("x".repeat(300 * 1024));
  }
});

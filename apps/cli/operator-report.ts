export interface OperatorFailureDetails {
  observed?: string;
  reason?: string;
  nextAction?: string;
  hardwareDispatch?: "NO" | "UNKNOWN";
}

export function operatorReasonCode(message: string): string {
  if (/^[a-z0-9_:-]+$/.test(message)) return message;
  return (
    message
      .split(/[.\n]/, 1)[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 96) || "fail_closed_before_dispatch"
  );
}

export function operatorFailureReport(
  status: "FAILED" | "BLOCKED",
  message: string,
  details: OperatorFailureDetails = {},
): string {
  return (
    `${status}\n` +
    `Observed: ${details.observed ?? message}\n` +
    `Reason: ${details.reason ?? operatorReasonCode(message)}\n` +
    `Hardware dispatch: ${details.hardwareDispatch ?? "NO"}\n` +
    `Next action: ${details.nextAction ?? message}\n`
  );
}

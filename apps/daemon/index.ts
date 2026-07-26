import type {
  ExecutionDecision,
  ExecutionGate,
  ExecutionRequest
} from '../../packages/execution-gate';

export type DaemonResult<TAction, TState, TResult> =
  | { decision: Exclude<ExecutionDecision<TAction, TState>, { status: 'allowed' }> }
  | { decision: { status: 'allowed'; reason: string }; result: TResult };

/**
 * Headless composition root. Networking/process supervision is deliberately
 * outside the first-round core; this service has no UI or Electron dependency.
 */
export class ReleaseGateDaemon<TAction, TState, TResult> {
  constructor(private readonly gate: ExecutionGate<TAction, TState, TResult>) {}

  async handle(
    request: ExecutionRequest<TAction, TState>
  ): Promise<DaemonResult<TAction, TState, TResult>> {
    const decision = await this.gate.evaluate(request);
    if (decision.status !== 'allowed') return { decision };
    const result = await this.gate.execute(decision.authorizedRequest);
    return {
      decision: { status: 'allowed', reason: decision.reason },
      result
    };
  }
}

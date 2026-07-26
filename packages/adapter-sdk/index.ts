/**
 * ReleaseGate adapter contract. Adapters receive an opaque permit but have no
 * API for creating one. The gate retains runtime ownership and single-use
 * validation of every permit.
 */
export type {
  ActionDispatcher as ReleaseGateAdapter,
  ExecutionPermit
} from '../execution-gate';

export type {
  ControllerSink,
  DispatchResult
} from '../ros2-gateway';

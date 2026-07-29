import { canonicalJson, sha256 } from '../core/evidence';
import type { ConsumePermitRequest } from './contract';
import type { RlsokCloudClient } from './client';

interface LocalDispatcher<TAction, TResult> {
  dispatch(action: TAction, localPermit: unknown): Promise<TResult>;
}

/**
 * Final cloud-connected dispatch boundary.
 *
 * Use this object as the dispatcher passed to ReleaseExecutionGate. Core first
 * creates its stricter, one-second, single-use local permit. Immediately before
 * the real adapter is called, this boundary refreshes cloud release state and
 * atomically consumes the context-bound cloud permit. Any cloud failure denies
 * dispatch; there is no standalone fallback.
 */
export class CloudConnectedDispatchBoundary<TAction, TResult> {
  private used = false;

  constructor(
    private readonly cloud: RlsokCloudClient,
    private readonly permitId: string,
    private readonly binding: ConsumePermitRequest,
    private readonly dispatcher: LocalDispatcher<TAction, TResult>
  ) {}

  async dispatch(action: TAction, localPermit: unknown): Promise<TResult> {
    if (this.used) throw new Error('cloud_dispatch_boundary_reused');
    this.used = true;
    if (sha256(canonicalJson(action)) !== this.binding.actionHash) {
      throw new Error('cloud_action_hash_mismatch');
    }
    const release = await this.cloud.getRelease(this.binding.releaseId);
    if (
      release.state !== 'approved'
      || release.contentHash !== this.binding.contentHash
    ) {
      throw new Error('cloud_release_not_currently_approved');
    }
    await this.cloud.consumePermit(this.permitId, this.binding);
    return this.dispatcher.dispatch(action, localPermit);
  }
}

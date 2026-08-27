import { canonicalJson, sha256 } from "../core/evidence";
import type { ConsumePermitRequest } from "./contract";
import type { RlsokCloudClient } from "./client";

interface LocalDispatcher<TAction, TResult> {
  dispatch(action: TAction, localPermit: unknown): Promise<TResult>;
  observeShadow?(action: TAction, localPermit: unknown): Promise<TResult>;
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
  private localConsumed = false;
  private cloudConsumed = false;
  private readonly localPermits = new WeakMap<
    object,
    {
      actionHash: string;
      expiresAt: number;
      configurationDigest: string;
    }
  >();

  constructor(
    private readonly cloud: RlsokCloudClient,
    private readonly permitId: string,
    private readonly binding: ConsumePermitRequest,
    private readonly dispatcher: LocalDispatcher<TAction, TResult>,
    private readonly currentConfigurationDigest: () => Promise<string | null>,
  ) {}

  get localPermitWasConsumed(): boolean {
    return this.localConsumed;
  }

  get cloudPermitWasConsumed(): boolean {
    return this.cloudConsumed;
  }

  issueLocalPermit(action: TAction, now = Date.now()): object {
    if (sha256(canonicalJson(action)) !== this.binding.actionHash) {
      throw new Error("cloud_action_hash_mismatch");
    }
    const permit = Object.freeze({});
    this.localPermits.set(permit, {
      actionHash: this.binding.actionHash,
      expiresAt: now + 1_000,
      configurationDigest: this.binding.configurationDigest,
    });
    return permit;
  }

  private consumeLocalPermit(
    action: TAction,
    localPermit: unknown,
    now = Date.now(),
  ): void {
    if (
      typeof localPermit !== "object" ||
      localPermit === null ||
      !this.localPermits.has(localPermit)
    ) {
      throw new Error("local_execution_permit_invalid");
    }
    const record = this.localPermits.get(localPermit)!;
    this.localPermits.delete(localPermit);
    if (
      record.expiresAt <= now ||
      record.actionHash !== this.binding.actionHash ||
      record.configurationDigest !== this.binding.configurationDigest ||
      sha256(canonicalJson(action)) !== record.actionHash
    ) {
      throw new Error("local_execution_permit_invalid");
    }
    this.localConsumed = true;
  }

  private async authorizeFinalBoundary(
    action: TAction,
    localPermit: unknown,
  ): Promise<void> {
    if (this.used) throw new Error("cloud_dispatch_boundary_reused");
    this.used = true;
    this.consumeLocalPermit(action, localPermit);
    if (sha256(canonicalJson(action)) !== this.binding.actionHash) {
      throw new Error("cloud_action_hash_mismatch");
    }
    const configurationDigest = await this.currentConfigurationDigest();
    if (!configurationDigest) {
      throw new Error("configuration_missing");
    }
    if (configurationDigest !== this.binding.configurationDigest) {
      throw new Error("configuration_mismatch");
    }
    const release = await this.cloud.getRelease(this.binding.releaseId);
    if (
      release.state !== "approved" ||
      release.contentHash !== this.binding.contentHash
    ) {
      throw new Error("cloud_release_not_currently_approved");
    }
    await this.cloud.consumePermit(this.permitId, this.binding);
    this.cloudConsumed = true;
  }

  async dispatch(action: TAction, localPermit: unknown): Promise<TResult> {
    await this.authorizeFinalBoundary(action, localPermit);
    return this.dispatcher.dispatch(action, localPermit);
  }

  async evaluateShadow(
    action: TAction,
    localPermit: unknown,
  ): Promise<TResult> {
    if (!this.dispatcher.observeShadow) {
      throw new Error("cloud_shadow_adapter_missing");
    }
    await this.authorizeFinalBoundary(action, localPermit);
    return this.dispatcher.observeShadow(action, localPermit);
  }
}

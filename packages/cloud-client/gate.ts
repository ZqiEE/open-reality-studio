import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../core/evidence";
import type { ConsumePermitRequest } from "./contract";
import type { RlsokCloudClient } from "./client";

interface LocalDispatcher<TAction, TResult> {
  dispatch(action: TAction, localPermit: unknown): Promise<TResult>;
  observeShadow?(action: TAction, localPermit: unknown): Promise<TResult>;
}

interface LocalPermitRecord {
  actionHash: string;
  issuedAt: number;
  expiresAt: number;
  issuedAtMonotonic: number;
  expiresAtMonotonic: number;
  configurationDigest: string;
}

const MAXIMUM_DATE_EPOCH_MS = 8_640_000_000_000_000;

function validEpochMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAXIMUM_DATE_EPOCH_MS;
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
  private cloudConsumptionState: "not_consumed" | "consumed" | "unknown" =
    "not_consumed";
  private readonly localPermits = new WeakMap<
    object,
    LocalPermitRecord
  >();
  private readonly binding: ConsumePermitRequest;

  constructor(
    private readonly cloud: RlsokCloudClient,
    private readonly permitId: string,
    binding: ConsumePermitRequest,
    private readonly dispatcher: LocalDispatcher<TAction, TResult>,
    private readonly currentConfigurationDigest: () => Promise<string | null>,
    private readonly validateCurrentLocalAuthority?: () => void,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
    this.binding = Object.freeze({ ...binding });
  }

  get localPermitWasConsumed(): boolean {
    return this.localConsumed;
  }

  get cloudPermitWasConsumed(): boolean {
    return this.cloudConsumptionState === "consumed";
  }

  get cloudPermitConsumptionState(): "not_consumed" | "consumed" | "unknown" {
    return this.cloudConsumptionState;
  }

  issueLocalPermit(action: TAction, now = Date.now()): object {
    const issuedAtMonotonic = this.monotonicNow();
    if (
      !validEpochMilliseconds(now) ||
      !validEpochMilliseconds(now + 1_000) ||
      !Number.isFinite(issuedAtMonotonic)
    ) {
      throw new Error("local_execution_permit_time_invalid");
    }
    if (sha256(canonicalJson(action)) !== this.binding.actionHash) {
      throw new Error("cloud_action_hash_mismatch");
    }
    const permit = Object.freeze({});
    this.localPermits.set(permit, {
      actionHash: this.binding.actionHash,
      issuedAt: now,
      expiresAt: now + 1_000,
      issuedAtMonotonic,
      expiresAtMonotonic: issuedAtMonotonic + 1_000,
      configurationDigest: this.binding.configurationDigest,
    });
    return permit;
  }

  private consumeLocalPermit(
    action: TAction,
    localPermit: unknown,
    now = Date.now(),
  ): LocalPermitRecord {
    if (
      typeof localPermit !== "object" ||
      localPermit === null ||
      !this.localPermits.has(localPermit)
    ) {
      throw new Error("local_execution_permit_invalid");
    }
    const record = this.localPermits.get(localPermit)!;
    this.localPermits.delete(localPermit);
    const consumedAtMonotonic = this.monotonicNow();
    if (
      !validEpochMilliseconds(now) ||
      !Number.isFinite(consumedAtMonotonic) ||
      consumedAtMonotonic < record.issuedAtMonotonic ||
      record.expiresAtMonotonic <= consumedAtMonotonic ||
      now < record.issuedAt ||
      record.expiresAt <= now ||
      record.actionHash !== this.binding.actionHash ||
      record.configurationDigest !== this.binding.configurationDigest ||
      sha256(canonicalJson(action)) !== record.actionHash
    ) {
      throw new Error("local_execution_permit_invalid");
    }
    this.localConsumed = true;
    return record;
  }

  private assertLocalPermitCurrent(
    record: LocalPermitRecord,
    now = Date.now(),
  ): void {
    const currentMonotonic = this.monotonicNow();
    if (
      !validEpochMilliseconds(now) ||
      !Number.isFinite(currentMonotonic) ||
      currentMonotonic < record.issuedAtMonotonic ||
      record.expiresAtMonotonic <= currentMonotonic ||
      now < record.issuedAt ||
      record.expiresAt <= now
    ) {
      throw new Error("local_execution_permit_expired");
    }
  }

  private async authorizeFinalBoundary(
    action: TAction,
    localPermit: unknown,
  ): Promise<void> {
    if (this.used) throw new Error("cloud_dispatch_boundary_reused");
    this.used = true;
    const localPermitRecord = this.consumeLocalPermit(action, localPermit);
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
      release.releaseId !== this.binding.releaseId ||
      release.state !== "approved" ||
      release.contentHash !== this.binding.contentHash
    ) {
      throw new Error("cloud_release_not_currently_approved");
    }
    this.validateCurrentLocalAuthority?.();
    this.assertLocalPermitCurrent(localPermitRecord);
    // Once the request is initiated, a transport failure cannot distinguish a
    // rejected request from a committed consume whose response was lost.
    this.cloudConsumptionState = "unknown";
    await this.cloud.consumePermit(this.permitId, this.binding);
    this.cloudConsumptionState = "consumed";
    this.assertLocalPermitCurrent(localPermitRecord);
  }

  private prepareBoundAction(action: TAction): TAction {
    const canonical = canonicalJson(action);
    if (sha256(canonical) !== this.binding.actionHash) {
      throw new Error("cloud_action_hash_mismatch");
    }
    // The caller must not be able to mutate adapter-visible bytes while the
    // final Cloud/configuration checks are awaiting I/O.
    return JSON.parse(canonical) as TAction;
  }

  async dispatch(action: TAction, localPermit: unknown): Promise<TResult> {
    const preparedAction = this.prepareBoundAction(action);
    await this.authorizeFinalBoundary(preparedAction, localPermit);
    return this.dispatcher.dispatch(preparedAction, localPermit);
  }

  async evaluateShadow(
    action: TAction,
    localPermit: unknown,
  ): Promise<TResult> {
    if (!this.dispatcher.observeShadow) {
      throw new Error("cloud_shadow_adapter_missing");
    }
    const preparedAction = this.prepareBoundAction(action);
    await this.authorizeFinalBoundary(preparedAction, localPermit);
    return this.dispatcher.observeShadow(preparedAction, localPermit);
  }
}

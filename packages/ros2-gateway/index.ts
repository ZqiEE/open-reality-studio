import type { ExecutablePolicySpec } from '../exec-spec';

export interface ReleaseResolver {
  resolveActiveRelease(
    deviceId: string,
    proposerIdentity: string
  ): Promise<ExecutablePolicySpec>;
}

/** Exact device+proposer binding; absence fails closed. */
export class InMemoryReleaseResolver implements ReleaseResolver {
  private readonly releases = new Map<string, ExecutablePolicySpec>();

  bind(deviceId: string, proposerIdentity: string, release: ExecutablePolicySpec): void {
    this.releases.set(`${deviceId}\0${proposerIdentity}`, release);
  }

  async resolveActiveRelease(
    deviceId: string,
    proposerIdentity: string
  ): Promise<ExecutablePolicySpec> {
    const release = this.releases.get(`${deviceId}\0${proposerIdentity}`);
    if (!release) throw new Error('active_release_not_found');
    return release;
  }
}

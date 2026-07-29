import { lstatSync, readFileSync } from 'node:fs';

export type ExecutionMode = 'standalone' | 'cloud-connected';

export interface CloudClientConfig {
  apiUrl: URL;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  safeRetryCount: number;
}

function readProtectedApiKey(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('cloud_api_key_file_must_be_regular_non_symlink');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o007) !== 0) {
    throw new Error('cloud_api_key_file_must_not_be_world_accessible');
  }
  const key = readFileSync(path, 'utf8').trim();
  if (!key) throw new Error('cloud_api_key_missing');
  return key;
}

function apiUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('cloud_api_url_credentials_or_fragment_forbidden');
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('cloud_api_url_requires_https_except_loopback');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

export function executionMode(
  source: NodeJS.ProcessEnv = process.env
): ExecutionMode {
  const mode = source.RLSOK_EXECUTION_MODE ?? 'standalone';
  if (mode !== 'standalone' && mode !== 'cloud-connected') {
    throw new Error('RLSOK_EXECUTION_MODE_must_be_standalone_or_cloud-connected');
  }
  return mode;
}

export function loadCloudClientConfig(
  source: NodeJS.ProcessEnv = process.env
): CloudClientConfig {
  const url = source.RLSOK_CLOUD_API_URL;
  const key = source.RLSOK_CLOUD_API_KEY
    ?? (source.RLSOK_CLOUD_API_KEY_FILE
      ? readProtectedApiKey(source.RLSOK_CLOUD_API_KEY_FILE)
      : undefined);
  if (!url) throw new Error('RLSOK_CLOUD_API_URL_is_required');
  if (!key?.trim()) throw new Error('RLSOK_CLOUD_API_KEY_is_required');
  return {
    apiUrl: apiUrl(url),
    apiKey: key.trim(),
    timeoutMs: 5_000,
    maxResponseBytes: 1_048_576,
    safeRetryCount: 1
  };
}

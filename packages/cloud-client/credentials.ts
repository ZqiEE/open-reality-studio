import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredCloudCredentials { apiUrl: string; apiKey: string }

export function cloudCredentialsPath(source: NodeJS.ProcessEnv = process.env): string {
  const base = process.platform === 'win32'
    ? source.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : source.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'rlsok', 'cloud-credentials.json');
}

export function readStoredCloudCredentials(source: NodeJS.ProcessEnv = process.env): StoredCloudCredentials | null {
  const path = cloudCredentialsPath(source);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_096) {
    throw new Error('stored_cloud_credentials_must_be_small_regular_non_symlink');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('stored_cloud_credentials_must_be_user_only');
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredCloudCredentials>;
  if (typeof parsed.apiUrl !== 'string' || typeof parsed.apiKey !== 'string' || !/^rlsok_[A-Za-z0-9_-]{43}$/.test(parsed.apiKey)) throw new Error('stored_cloud_credentials_invalid');
  return { apiUrl: parsed.apiUrl, apiKey: parsed.apiKey };
}

export function writeStoredCloudCredentials(credentials: StoredCloudCredentials, source: NodeJS.ProcessEnv = process.env): string {
  const path = cloudCredentialsPath(source);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
}

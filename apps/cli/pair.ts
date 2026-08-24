import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { readStoredCloudCredentials, writeStoredCloudCredentials } from '../../packages/cloud-client/credentials';

const DEFAULT_CLOUD = 'https://api.rlsok.com';

export function pairUsage(): string {
  return [
    'usage: rlsok pair [--cloud https://api.rlsok.com] [--no-browser] [--replace]',
    '',
    'Pair this robot-side runtime with Hosted RLSOK Cloud. Approval remains a',
    'separate action performed by an authenticated Workspace administrator.',
  ].join('\n');
}

export function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `pairing_http_${response.status}`);
  return body;
}

export async function runPairCommand(args: string[]): Promise<number> {
  let apiUrl = DEFAULT_CLOUD;
  let launchBrowser = true;
  let replaceExisting = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--help' || args[index] === '-h') {
      process.stdout.write(`${pairUsage()}\n`);
      return 0;
    }
    if (args[index] === '--cloud' && args[index + 1]) apiUrl = args[++index];
    else if (args[index] === '--no-browser') launchBrowser = false;
    else if (args[index] === '--replace') replaceExisting = true;
    else throw new Error(pairUsage().split('\n', 1)[0]);
  }
  const existing = readStoredCloudCredentials();
  if (existing && !replaceExisting) throw new Error('runtime_already_paired_use_--replace');
  const parsedUrl = new URL(apiUrl);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' && !(local && parsedUrl.protocol === 'http:')) throw new Error('pairing_cloud_url_requires_https_except_loopback');
  const started = await responseJson(await fetch(`${apiUrl.replace(/\/$/, '')}/v1/runtime-pairings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceLabel: hostname().slice(0, 120) || 'local-runtime' }),
    signal: AbortSignal.timeout(10_000), redirect: 'error'
  }));
  const { pairingId, pairingToken, userCode, verificationUri } = started;
  if (![pairingId, pairingToken, userCode, verificationUri].every((value) => typeof value === 'string')) throw new Error('pairing_response_invalid');
  const browserUrl = new URL(verificationUri as string);
  browserUrl.searchParams.set('code', userCode as string);
  process.stdout.write(`Pairing code: ${userCode}\nOpen: ${browserUrl}\nWaiting for approval...\n`);
  if (launchBrowser) openBrowser(browserUrl.toString());
  const expiresAt = Date.parse(String(started.expiresAt));
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const status = await responseJson(await fetch(`${apiUrl.replace(/\/$/, '')}/v1/runtime-pairings/${pairingId}`, {
      headers: { authorization: `Bearer ${pairingToken}` }, signal: AbortSignal.timeout(10_000), redirect: 'error'
    }));
    if (status.status === 'approved') {
      const path = writeStoredCloudCredentials({ apiUrl: apiUrl.replace(/\/$/, ''), apiKey: pairingToken as string });
      process.stdout.write(`Paired with Hosted RLSOK Cloud. Credentials stored at ${path}.\n`);
      if (existing) process.stdout.write('The previous runtime credential remains active until an administrator revokes it in Dashboard > Operations.\n');
      return 0;
    }
    if (status.status === 'revoked') throw new Error('pairing_revoked');
    if (status.status === 'expired') break;
  }
  throw new Error('pairing_expired');
}

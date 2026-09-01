import { spawn } from "node:child_process";

export interface BrowserProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null) => void): this;
  unref(): void;
}

export type BrowserSpawn = (
  command: string,
  args: string[],
  options: {
    detached: true;
    stdio: "ignore";
    windowsHide: true;
  },
) => BrowserProcess;

export interface BrowserLaunchDependencies {
  platform?: NodeJS.Platform;
  spawnProcess?: BrowserSpawn;
  writeError?: (message: string) => void;
}

const BROWSER_UNAVAILABLE =
  "Browser launch unavailable. Continue manually with the URL printed above, or rerun with --no-browser.\n";
const BROWSER_EXITED =
  "Browser did not open successfully. Continue manually with the URL printed above, or rerun with --no-browser.\n";
const BROWSER_UNSUPPORTED =
  "Automatic browser launch is unsupported on this platform. Continue manually with the URL printed above, or rerun with --no-browser.\n";

export function launchBrowser(
  url: string,
  dependencies: BrowserLaunchDependencies = {},
): void {
  const platform = dependencies.platform ?? process.platform;
  const writeError =
    dependencies.writeError ?? ((message: string) => process.stderr.write(message));
  const launcher =
    platform === "win32"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : platform === "darwin"
        ? { command: "open", args: [url] }
        : platform === "linux"
          ? { command: "xdg-open", args: [url] }
          : undefined;
  if (!launcher) {
    writeError(BROWSER_UNSUPPORTED);
    return;
  }

  let reported = false;
  const reportOnce = (message: string): void => {
    if (reported) return;
    reported = true;
    writeError(message);
  };
  const spawnProcess: BrowserSpawn =
    dependencies.spawnProcess ??
    ((command, args, options) => spawn(command, args, options));
  try {
    const child = spawnProcess(launcher.command, launcher.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reportOnce(BROWSER_UNAVAILABLE));
    child.once("exit", (code) => {
      if (code !== 0) reportOnce(BROWSER_EXITED);
    });
    child.unref();
  } catch {
    reportOnce(BROWSER_UNAVAILABLE);
  }
}

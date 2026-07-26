import { ActivityIndicator } from './ActivityIndicator';

export function LaunchShell() {
  return (
    <main className="rw-launch-shell" data-component="LaunchShell" data-startup-state="renderer_hydration">
      <div className="rw-startup-brand">
        <span className="rw-lang-en">RLSOK ReleaseGate</span>
        <span className="rw-lang-zh">RLSOK ReleaseGate</span>
      </div>
      <div className="rw-startup-status" role="status" aria-live="polite" aria-atomic="true">
        <ActivityIndicator />
        <h1>
          <span className="rw-lang-en">Initializing system</span>
          <span className="rw-lang-zh">系统初始化中</span>
        </h1>
      </div>
      <p>
        <span className="rw-lang-en">Loading the local workspace interface.</span>
        <span className="rw-lang-zh">正在加载本地工作区界面。</span>
      </p>
    </main>
  );
}

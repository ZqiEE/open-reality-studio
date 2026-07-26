'use client';

import { useEffect, useRef } from 'react';
import { StartupDetails } from './StartupDetails';

export function StartupFailureView({ error, reset, reload, language = 'en' }: { error: Error & { digest?: string }; reset: () => void; reload: () => void; language?: 'zh' | 'en' }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => retryRef.current?.focus(), []);
  const detail = [error.message, error.digest ? `digest: ${error.digest}` : '', error.stack ?? ''].filter(Boolean).join('\n');
  return (
    <main className="rw-launch-shell rw-startup-failure" data-component="StartupFailureView" data-startup-state="fatal_error">
      <div className="rw-startup-brand">RLSOK ReleaseGate</div>
      <div className="rw-startup-status" role="alert" aria-live="assertive" aria-atomic="true">
        <h1>{language === 'zh' ? '应用界面无法加载' : 'Application interface could not load'}</h1>
      </div>
      <p>{language === 'zh' ? '工作区渲染发生错误。你可以重新加载界面。' : 'The workspace renderer encountered an error. You can reload the interface.'}</p>
      <StartupDetails detail={detail} language={language} />
      <p className="rw-startup-evidence">{language === 'zh' ? '界面崩溃不能证明此前的硬件传输状态。请以 Audit Evidence 审计证据核实真实硬件执行状态。' : 'A UI crash does not prove prior hardware delivery state. Refer to Audit Evidence to verify real hardware execution state.'}</p>
      <div className="rw-startup-actions">
        <button ref={retryRef} type="button" onClick={reset}>{language === 'zh' ? '恢复界面' : 'Recover interface'}</button>
        <button type="button" onClick={reload}>{language === 'zh' ? '重新加载应用' : 'Reload app'}</button>
      </div>
    </main>
  );
}

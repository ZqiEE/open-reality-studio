export type StartupLanguage = 'zh' | 'en';
export type StartupShellState = 'cold_start' | 'initializing' | 'recoverable_error' | 'fatal_error';

export interface StartupShellOptions {
  language: StartupLanguage;
  state: StartupShellState;
  detail?: string;
}

const copy = {
  zh: {
    brand: 'RLSOK ReleaseGate',
    cold_start: ['系统初始化中', '正在加载本地应用服务。'],
    initializing: ['系统仍在初始化', '本地应用服务启动时间较长，完成后将自动进入工作台。'],
    recoverable_error: ['启动异常', '本地应用服务未能启动。你可以安全地重试或退出。'],
    fatal_error: ['应用无法启动', '桌面运行时发生不可恢复的错误。请查看详情后重新加载或退出。'],
    showDetails: '显示详情',
    hideDetails: '收起详情',
    copyError: '复制错误',
    copied: '已复制',
    retry: '重试',
    reload: '重新加载',
    exit: '退出',
    evidence: '界面状态不代表硬件传输结果。请以 Audit Evidence 审计证据核实真实硬件执行状态。'
  },
  en: {
    brand: 'RLSOK ReleaseGate',
    cold_start: ['Initializing system', 'Loading the local application service.'],
    initializing: ['Initialization is taking longer', 'The local application service is still starting. The workspace will open automatically.'],
    recoverable_error: ['Startup fault', 'The local application service could not start. You can safely retry or exit.'],
    fatal_error: ['Application could not start', 'The desktop runtime encountered an unrecoverable error. Review the details, then reload or exit.'],
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    copyError: 'Copy error',
    copied: 'Copied',
    retry: 'Retry',
    reload: 'Reload',
    exit: 'Exit',
    evidence: 'UI state does not confirm hardware transmission. Refer to Audit Evidence to verify real hardware execution state.'
  }
} as const;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function startupShellHtml({ language, state, detail = '' }: StartupShellOptions) {
  const text = copy[language];
  const [title, description] = text[state];
  const isFailure = state === 'recoverable_error' || state === 'fatal_error';
  const isFatal = state === 'fatal_error';
  const safeDetail = escapeHtml(detail || (language === 'zh' ? '没有提供更多错误详情。' : 'No additional error details were provided.'));
  const action = isFatal ? 'reload' : 'retry';
  const actionLabel = isFatal ? text.reload : text.retry;

  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <style>
      :root { color-scheme: dark; --background:#090A0C; --surface:#121418; --raised:#1C1E24; --border:#2A2D35; --strong:#3A3F4A; --primary:#E5E7EB; --secondary:#9CA3AF; --warning:#FACC15; --danger:#F43F5E; }
      * { box-sizing: border-box; }
      html, body { width:100%; min-width:100%; height:100%; min-height:100%; margin:0; overflow:hidden; background:#090A0C; color:#E5E7EB; }
      body { display:flex; align-items:center; justify-content:center; padding:16px; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; line-height:1.5; -webkit-font-smoothing:antialiased; }
      main { width:min(30rem,100%); max-height:calc(100vh - 32px); overflow:auto; border:1px solid var(--border); background:var(--surface); padding:32px 40px; }
      main[data-failure="recoverable_error"] { border-left:3px solid var(--warning); }
      main[data-failure="fatal_error"] { border-left:3px solid var(--danger); }
      .brand { height:24px; color:var(--secondary); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      .status { display:flex; align-items:center; gap:12px; margin-top:24px; }
      .indicator { position:relative; width:16px; height:2px; flex:0 0 16px; overflow:hidden; background:var(--strong); }
      .indicator::after { position:absolute; inset:0; width:50%; content:""; background:var(--secondary); animation:rw-startup-progress 1.5s linear infinite; }
      h1 { margin:0; color:var(--primary); font-size:16px; font-weight:500; line-height:24px; }
      p { margin:8px 0 0; color:var(--secondary); font-size:13px; line-height:20px; }
      .details-toggle { margin-top:20px; border:0; padding:0; background:transparent; color:var(--primary); font-family:inherit; font-size:13px; font-weight:500; line-height:20px; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
      .details { position:relative; max-height:160px; margin-top:8px; overflow:auto; border:1px solid var(--border); background:var(--raised); padding:32px 12px 12px; color:var(--secondary); font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
      .copy { position:absolute; top:6px; right:6px; min-height:24px; border:1px solid var(--strong); background:var(--surface); padding:0 8px; color:var(--primary); font-family:inherit; font-size:11px; font-weight:500; line-height:22px; cursor:pointer; }
      .evidence { margin-top:16px; border-top:1px solid var(--border); padding-top:12px; font-size:12px; line-height:18px; }
      .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12px; margin-top:24px; }
      .actions button { min-width:88px; min-height:36px; border:1px solid var(--strong); background:var(--raised); padding:0 16px; color:var(--primary); font-family:inherit; font-size:13px; font-weight:500; line-height:34px; cursor:pointer; }
      .actions .exit { margin-right:auto; background:transparent; }
      button:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
      @keyframes rw-startup-progress { from { transform:translateX(-110%); } to { transform:translateX(210%); } }
      @media (max-height:540px), (max-width:640px) { main { padding:24px; } .status { margin-top:16px; } .actions { margin-top:16px; } }
      @media (prefers-reduced-motion:reduce) { .indicator::after { width:100%; animation:none; transform:none; } }
      @media (forced-colors:active) { main { border:1px solid CanvasText; } main[data-failure] { border-left:3px double CanvasText; } button,.details { border-color:CanvasText; } button:focus-visible { outline:2px solid Highlight; } }
    </style>
  </head>
  <body>
    <main data-component="LaunchShell" data-startup-state="${state}"${isFailure ? ` data-failure="${state}"` : ''}>
      <div class="brand">${text.brand}</div>
      <div class="status" role="${isFailure ? 'alert' : 'status'}" aria-live="${isFailure ? 'assertive' : 'polite'}" aria-atomic="true">
        ${isFailure ? '' : '<span class="indicator" aria-hidden="true"></span>'}
        <h1 tabindex="${isFailure ? '-1' : '0'}">${title}</h1>
      </div>
      <p>${description}</p>
      ${isFailure ? `<button class="details-toggle" type="button" aria-expanded="false" aria-controls="startup-details">${text.showDetails}</button>
      <div id="startup-details" class="details" hidden><button class="copy" type="button">${text.copyError}</button>${safeDetail}</div>
      <p class="evidence">${text.evidence}</p>
      <div class="actions"><button class="exit" type="button" data-startup-action="exit">${text.exit}</button><button type="button" data-startup-action="${action}">${actionLabel}</button></div>` : ''}
    </main>
    ${isFailure ? `<script>
      const toggle=document.querySelector('.details-toggle'); const details=document.querySelector('.details'); const copy=document.querySelector('.copy');
      toggle.addEventListener('click',()=>{const open=details.hidden; details.hidden=!open; toggle.setAttribute('aria-expanded',String(open)); toggle.textContent=open?${JSON.stringify(text.hideDetails)}:${JSON.stringify(text.showDetails)};});
      copy.addEventListener('click',async()=>{const value=details.childNodes[1]?.textContent||details.textContent||''; try{await navigator.clipboard.writeText(value);}catch{const area=document.createElement('textarea');area.value=value;document.body.append(area);area.select();document.execCommand('copy');area.remove();} copy.textContent=${JSON.stringify(text.copied)};});
      document.querySelectorAll('[data-startup-action]').forEach((button)=>button.addEventListener('click',()=>{location.href='realitywarden-startup://'+button.dataset.startupAction;}));
      document.querySelector('h1').focus();
    </script>` : ''}
  </body>
</html>`;
}

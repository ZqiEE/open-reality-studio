'use client';

import { useEffect, useRef, useState } from 'react';
import type { UiLanguage } from './LabConfigurator';
import { t } from '@/lib/i18n';

interface FileMenuProps {
  language: UiLanguage;
  workspaceMode: 'real' | 'simulation';
  onNew: () => void;
  onOpen: () => void;
  onImportAsset: () => void;
  onImportManual: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRestore: () => void;
  onOpenSupport: () => void;
  onExportDiagnostics: () => void;
  onAbout: () => void;
}

export function FileMenu({ language, workspaceMode, onNew, onOpen, onImportAsset, onImportManual, onSave, onSaveAs, onRestore, onOpenSupport, onExportDiagnostics, onAbout }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const items: Array<{ id: string; label: string; action: () => void; simulationOnly?: true }> = [
    { id: 'new', label: t(language, 'app_new'), action: onNew },
    { id: 'open', label: t(language, 'app_open'), action: onOpen },
    ...(workspaceMode === 'simulation' ? [
      { id: 'import-asset', label: language === 'zh' ? '导入仿真资产…' : 'Import Simulation Asset…', action: onImportAsset, simulationOnly: true as const },
      { id: 'import-manual', label: language === 'zh' ? '导入设备手册（仅仿真）…' : 'Import Device Manual (Simulation Only)…', action: onImportManual, simulationOnly: true as const },
    ] : []),
    { id: 'save', label: t(language, 'app_save_project'), action: onSave },
    { id: 'save-as', label: t(language, 'app_save_as'), action: onSaveAs },
    { id: 'restore', label: t(language, 'app_restore'), action: onRestore },
    { id: 'support', label: language === 'zh' ? '打开支持指南' : 'Open Support Guide', action: onOpenSupport },
    { id: 'diagnostics', label: language === 'zh' ? '导出本地诊断包…' : 'Export Local Diagnostics…', action: onExportDiagnostics },
    { id: 'about', label: language === 'zh' ? '关于 RealityWarden' : 'About RealityWarden', action: onAbout }
  ];

  const focusItem = (index: number) => {
    requestAnimationFrame(() => {
      detailsRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[index]?.focus();
    });
  };

  const openAt = (index: number) => {
    setOpen(true);
    focusItem(index);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  return (
    <details ref={detailsRef} open={open} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <summary
        ref={triggerRef}
        data-file-menu-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => { event.preventDefault(); if (open) setOpen(false); else openAt(0); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAt(event.key === 'ArrowDown' ? 0 : items.length - 1);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className="flex h-8 cursor-pointer select-none list-none items-center border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary"
      >
        {language === 'zh' ? '文件' : 'File'} <span className="ml-2 text-[10px] text-text-secondary">▾</span>
      </summary>
      <div className="rw-floating-panel absolute left-0 top-9 z-50 flex w-60 flex-col py-1" role="menu" aria-label={language === 'zh' ? '文件操作' : 'File actions'}>
        {items.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-file-action={item.id}
            data-simulation-file-action={item.simulationOnly ? item.id : undefined}
            tabIndex={-1}
            onClick={() => { setOpen(false); item.action(); }}
            onKeyDown={(event) => {
              let nextIndex: number | null = null;
              if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
              else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
              else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = items.length - 1;
              else if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
              }
              if (nextIndex !== null) {
                event.preventDefault();
                focusItem(nextIndex);
              }
            }}
            className="px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-raised"
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

interface AppHeaderProps extends FileMenuProps {
  realHardwareConnected: boolean;
  projectName: string;
  preflight: 'passed' | 'warning' | 'blocked';
  warningCount: number;
  /**
   * Run phase supplied by the single authoritative run state in app/page.tsx.
   * The header renders this value and derives no run words of its own.
   */
  result: 'idle' | 'gated' | 'executed' | 'blocked' | 'awaiting_human' | 'unsupported' | 'failed';
  customActionCount: number;
  hasReport: boolean;
  onQuickStart: () => void;
  onActions: () => void;
  onMarketplace: () => void;
  onFocusRealHardware: () => void;
  onWorkspaceModeChange: (mode: 'real' | 'simulation') => void;
  onExportReport: () => void;
  onExportReceipt: () => void;
  onExportAdapter: () => void;
  onLanguageChange: (language: UiLanguage) => void;
}

export function AppHeader(props: AppHeaderProps) {
  const { language, projectName, result, customActionCount, hasReport } = props;
  const realMode = props.workspaceMode === 'real';
  const resultClass = result === 'blocked' || result === 'failed'
    ? 'border-status-blocked-edge bg-status-blocked-surface text-status-blocked-soft'
    : result === 'gated'
      ? 'border-status-running-edge bg-status-warning-surface text-status-running'
      : result === 'executed'
        ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft'
        : result === 'awaiting_human' || result === 'unsupported'
          ? 'border-status-warning-edge bg-status-warning-surface text-status-warning'
          : 'border-border bg-surface-raised text-text-secondary';
  const resultText = result === 'blocked' ? t(language, 'status_safety_blocked')
    : result === 'failed' ? t(language, 'command_failed')
      : result === 'gated' ? t(language, 'status_playing_motion')
        : result === 'executed' ? t(language, 'status_executed')
          : result === 'awaiting_human' ? t(language, 'command_ask_human')
            : result === 'unsupported' ? t(language, 'command_coming_soon')
              : t(language, 'status_idle');
  return (
    <header data-component="AppHeader" className="flex h-12 w-full shrink-0 select-none items-center border-b border-border bg-surface">
      <div className="flex h-full w-[240px] shrink-0 items-center gap-2 border-r border-border px-3 xl:w-[280px]">
        <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{t(language, 'app_project')}</div><div className="truncate text-[15px] font-semibold text-text-primary">{projectName}</div></div>
        <div className="flex h-8 shrink-0 border border-border" role="group" aria-label={language === 'zh' ? '门的运行方式' : 'How to run the gate'}>
          <button title={language === 'zh' ? '真机 · REAL DEVICE' : 'REAL DEVICE'} type="button" aria-pressed={props.workspaceMode === 'real'} onClick={() => props.onWorkspaceModeChange('real')} className={`px-2 text-[11px] font-bold ${props.workspaceMode === 'real' ? 'bg-status-warning-surface text-status-warning' : 'bg-surface-raised text-text-secondary'}`}>{language === 'zh' ? '真机' : 'REAL'}</button>
          <button
            title={props.realHardwareConnected
              ? (language === 'zh' ? '断开真实设备并进入预演（不发硬件信号）' : 'Disconnect the REAL device and enter dry run (no hardware signal)')
              : (language === 'zh' ? '预演 · 不发硬件信号' : 'Dry run · no hardware signal')}
            type="button"
            aria-label={props.realHardwareConnected
              ? (language === 'zh' ? '断开真实设备并进入预演（不发硬件信号）' : 'Disconnect the REAL device and enter dry run (no hardware signal)')
              : (language === 'zh' ? '预演 · 不发硬件信号' : 'Dry run · no hardware signal')}
            aria-pressed={props.workspaceMode === 'simulation'}
            onClick={() => props.onWorkspaceModeChange('simulation')}
            className={`border-l border-border px-2 text-[11px] font-semibold ${props.workspaceMode === 'simulation' ? 'bg-[#0B2233] text-simulation' : 'bg-surface-raised text-text-secondary'}`}
          >
            {props.realHardwareConnected ? (language === 'zh' ? '断开 → 预演' : 'DISCONNECT → DRY RUN') : (language === 'zh' ? '预演' : 'DRY RUN')}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3">
        <nav className="flex shrink-0 items-center gap-2" aria-label={language === 'zh' ? '项目操作' : 'Project actions'}>
          <FileMenu {...props} />
          {realMode ? (
            <button data-real-hardware-focus type="button" onClick={props.onFocusRealHardware} className="h-8 shrink-0 whitespace-nowrap border border-status-warning-edge bg-status-warning-surface px-3 text-[13px] font-semibold text-status-warning">
              {props.realHardwareConnected
                ? (language === 'zh' ? '设备控制' : 'Device Controls')
                : (language === 'zh' ? '连接设备' : 'Connect Device')}
            </button>
          ) : (
            <>
              <button data-simulation-toolbar-action="quick-start" type="button" onClick={props.onQuickStart} className="h-8 shrink-0 whitespace-nowrap border border-accent px-3 text-[13px] font-semibold text-accent">{t(language, 'app_quick_start')}</button>
              <button data-simulation-toolbar-action="actions" data-action-composer-trigger type="button" onClick={props.onActions} className="h-8 shrink-0 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary">{language === 'zh' ? '自定义动作' : 'Actions'}{customActionCount ? ` (${customActionCount})` : ''}</button>
              <button data-simulation-toolbar-action="marketplace" data-marketplace-trigger type="button" title={language === 'zh' ? '仅声明式仿真资产；生态是路线图第二章，不授予任何真机权限' : 'Declarative simulation assets only; the ecosystem is chapter two of the roadmap and grants no real-device authority'} onClick={props.onMarketplace} className="h-8 shrink-0 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary">Marketplace</button>
            </>
          )}
        </nav>
        <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3">
          {realMode ? (
            <>
              <span data-real-connection-state={props.realHardwareConnected ? 'connected' : 'disconnected'} className={`h-7 shrink-0 border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide ${props.realHardwareConnected ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>{props.realHardwareConnected ? (language === 'zh' ? '设备已连接' : 'Device connected') : (language === 'zh' ? '设备未连接' : 'Device not connected')}</span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.12em] text-status-warning xl:inline">{language === 'zh' ? '门控执行 · 仅限右侧边界' : 'GATED · RIGHT BOUNDARY ONLY'}</span>
            </>
          ) : (
            <>
              <span className={`h-7 shrink-0 border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide ${resultClass}`}>{resultText}</span>
              <span className="h-6 w-px shrink-0 bg-border" />
              <button data-simulation-toolbar-action="export-report" type="button" onClick={props.onExportReport} disabled={!hasReport} className="h-8 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary disabled:opacity-40">{t(language, 'app_export_report')}</button>
              <button data-simulation-toolbar-action="export-receipt" type="button" title={language === 'zh' ? '导出防篡改的审计回执（JSON + Markdown + 可打印 HTML）' : 'Export a tamper-evident audit receipt (JSON + Markdown + printable HTML)'} onClick={props.onExportReceipt} disabled={!hasReport} className="h-8 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary disabled:opacity-40">{language === 'zh' ? '导出审计回执' : 'Export Receipt'}</button>
              <button data-simulation-toolbar-action="export-adapter" type="button" onClick={props.onExportAdapter} className="h-8 whitespace-nowrap border border-accent px-3 text-[13px] font-semibold text-accent">{t(language, 'app_export_adapter_package')}</button>
            </>
          )}
          <select data-interface-language value={language} onChange={(event) => props.onLanguageChange(event.target.value as UiLanguage)} aria-label={language === 'zh' ? '界面语言' : 'Interface language'} className="h-8 w-20 border border-border bg-surface-raised px-2 text-[12px] text-text-primary"><option value="zh">中文</option><option value="en">English</option></select>
        </div>
      </div>
    </header>
  );
}

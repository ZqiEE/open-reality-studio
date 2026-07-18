'use client';

import { useEffect, useRef, useState } from 'react';
import type { UiLanguage } from './LabConfigurator';
import { t } from '@/lib/i18n';

interface FileMenuProps {
  language: UiLanguage;
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

export function FileMenu({ language, onNew, onOpen, onImportAsset, onImportManual, onSave, onSaveAs, onRestore, onOpenSupport, onExportDiagnostics, onAbout }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const items: Array<{ id: string; label: string; action: () => void }> = [
    { id: 'new', label: t(language, 'app_new'), action: onNew },
    { id: 'open', label: t(language, 'app_open'), action: onOpen },
    { id: 'import-asset', label: t(language, 'app_import_asset'), action: onImportAsset },
    { id: 'import-manual', label: language === 'zh' ? '导入设备手册…' : 'Import Device Manual…', action: onImportManual },
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
  workspaceMode: 'real' | 'simulation';
  projectName: string;
  preflight: 'passed' | 'warning' | 'blocked';
  warningCount: number;
  result: 'idle' | 'running' | 'executed' | 'blocked';
  customActionCount: number;
  hasReport: boolean;
  onQuickStart: () => void;
  onActions: () => void;
  onMarketplace: () => void;
  onWorkspaceModeChange: (mode: 'real' | 'simulation') => void;
  onExportReport: () => void;
  onExportAdapter: () => void;
  onLanguageChange: (language: UiLanguage) => void;
}

export function AppHeader(props: AppHeaderProps) {
  const { language, projectName, result, customActionCount, hasReport } = props;
  const resultClass = result === 'blocked' ? 'border-status-blocked-edge bg-status-blocked-surface text-status-blocked-soft' : result === 'running' ? 'border-status-running-edge bg-status-warning-surface text-status-running' : result === 'executed' ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-border bg-surface-raised text-text-secondary';
  const resultText = result === 'blocked' ? t(language, 'status_safety_blocked') : result === 'running' ? t(language, 'status_playing_motion') : result === 'executed' ? t(language, 'status_executed') : t(language, 'status_idle');
  return (
    <header data-component="AppHeader" className="flex h-12 w-full shrink-0 select-none items-center border-b border-border bg-surface">
      <div className="flex h-full w-[240px] shrink-0 items-center gap-2 border-r border-border px-3 xl:w-[280px]">
        <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{t(language, 'app_project')}</div><div className="truncate text-[15px] font-semibold text-text-primary">{projectName}</div></div>
        <div className="flex h-8 shrink-0 border border-border" role="group" aria-label={language === 'zh' ? '工作区模式' : 'Workspace mode'}>
          <button title="REAL DEVICE" type="button" aria-pressed={props.workspaceMode === 'real'} onClick={() => props.onWorkspaceModeChange('real')} className={`px-2 text-[11px] font-bold ${props.workspaceMode === 'real' ? 'bg-status-warning-surface text-status-warning' : 'bg-surface-raised text-text-secondary'}`}>REAL</button>
          <button title="Simulation Lab" type="button" aria-pressed={props.workspaceMode === 'simulation'} onClick={() => props.onWorkspaceModeChange('simulation')} className={`border-l border-border px-2 text-[11px] font-semibold ${props.workspaceMode === 'simulation' ? 'bg-[#0B2233] text-simulation' : 'bg-surface-raised text-text-secondary'}`}>SIM LAB</button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3">
        <nav className="flex shrink-0 items-center gap-2" aria-label={language === 'zh' ? '项目操作' : 'Project actions'}>
          <FileMenu {...props} />
          <button type="button" onClick={props.onQuickStart} className="h-8 shrink-0 whitespace-nowrap border border-accent px-3 text-[13px] font-semibold text-accent">{t(language, 'app_quick_start')}</button>
          <button data-action-composer-trigger type="button" onClick={props.onActions} className="h-8 shrink-0 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary">{language === 'zh' ? '自定义动作' : 'Actions'}{customActionCount ? ` (${customActionCount})` : ''}</button>
          <button data-marketplace-trigger type="button" onClick={props.onMarketplace} className="h-8 shrink-0 whitespace-nowrap border border-status-warning-edge bg-status-warning-surface px-3 text-[13px] font-semibold text-status-warning">Marketplace</button>
        </nav>
        <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3">
          <span className={`h-7 shrink-0 border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide ${resultClass}`}>{resultText}</span>
          <span className="h-6 w-px shrink-0 bg-border" />
          <button type="button" onClick={props.onExportReport} disabled={!hasReport} className="h-8 whitespace-nowrap border border-border bg-surface-raised px-3 text-[13px] font-semibold text-text-primary disabled:opacity-40">{t(language, 'app_export_report')}</button>
          <button type="button" onClick={props.onExportAdapter} className="h-8 whitespace-nowrap border border-accent px-3 text-[13px] font-semibold text-accent">{t(language, 'app_export_adapter_package')}</button>
          <select data-interface-language value={language} onChange={(event) => props.onLanguageChange(event.target.value as UiLanguage)} aria-label={language === 'zh' ? '界面语言' : 'Interface language'} className="h-8 w-20 border border-border bg-surface-raised px-2 text-[12px] text-text-primary"><option value="zh">中文</option><option value="en">English</option></select>
        </div>
      </div>
    </header>
  );
}

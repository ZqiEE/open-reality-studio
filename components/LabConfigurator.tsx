'use client';

import { useMemo, useState } from 'react';
import type { DeviceScenario } from '@/lib/virtual-lab/DeviceScenario';
import type { DeviceProfile, DeviceType } from '@/types/deviceMeta';
import type { DeviceAsset } from '@/lib/assets/DeviceAsset';
import type { Locale } from '@/lib/i18n';
import { localizeCategory, localizeDeviceType, localizeDisplayName, localizeMetadataValue, localizeProfileName, localizeScenarioName, t } from '@/lib/i18n';
import { handleRovingTabKey } from '@/lib/ui/keyboardNavigation';

export type UiLanguage = Locale;

interface LabConfiguratorProps {
  language: UiLanguage;
  deviceTypes: DeviceType[];
  deviceType: DeviceType;
  profiles: DeviceProfile[];
  selectedProfileId: string;
  scenarios: DeviceScenario[];
  selectedScenarioId: string;
  deviceAssets: DeviceAsset[];
  selectedDeviceRunnable: boolean;
  selectedWorkspaceDeviceLabel: string | null;
  selectedWorkspaceAssetId?: string | null;
  onDeviceTypeChange: (deviceType: DeviceType) => void;
  onProfileChange: (profileId: string) => void;
  onScenarioChange: (scenarioId: string) => void;
  onAddAsset: (assetId: string) => void;
}

function SelectChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868B]" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{children}</div>;
}

const selectClassName =
  'h-7 w-full appearance-none rounded-[3px] border border-[#313338] bg-[#1E1F22] px-2 pr-7 text-[13px] font-medium text-[#E6EAF0] outline-none transition-colors hover:border-[#3A3D45] focus:border-[#0284C7] focus:ring-1 focus:ring-[#0284C7]';

const runnableDeviceTypes: DeviceType[] = ['robot_arm', 'smart_light', 'camera_sensor'];

function isRunnableDeviceV01(deviceType: DeviceType) {
  return runnableDeviceTypes.includes(deviceType);
}

function supportSuffix(language: UiLanguage, runnable: boolean) {
  return runnable ? t(language, 'support_supported') : t(language, 'support_coming_soon');
}

export function LabConfigurator({
  language,
  deviceTypes,
  deviceType,
  profiles,
  selectedProfileId,
  scenarios,
  selectedScenarioId,
  deviceAssets,
  selectedDeviceRunnable,
  selectedWorkspaceDeviceLabel,
  selectedWorkspaceAssetId,
  onDeviceTypeChange,
  onProfileChange,
  onScenarioChange,
  onAddAsset
}: LabConfiguratorProps) {
  const [assetQuery, setAssetQuery] = useState('');
  const [activeSection, setActiveSection] = useState<'devices' | 'assets'>('devices');
  const profileLabel = (profile: DeviceProfile) => localizeProfileName(language, profile.deviceMeta.display_name ?? profile.label ?? profile.id);
  const profileOptionLabel = (profile: DeviceProfile) => `${profileLabel(profile)} · ${supportSuffix(language, isRunnableDeviceV01(profile.deviceMeta.device_type))}`;
  const deviceTypeOptionLabel = (type: DeviceType) => `${localizeDeviceType(language, type)} · ${supportSuffix(language, isRunnableDeviceV01(type))}`;
  const scenarioLabel = (scenario: DeviceScenario) => localizeScenarioName(language, scenario.id);
  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    const assetsForDeviceType = deviceAssets.filter((asset) => asset.manifest.device_type === deviceType);
    if (!query) return assetsForDeviceType;
    return assetsForDeviceType.filter((asset) => {
      const manifest = asset.manifest;
      return [
        manifest.display_name,
        manifest.asset_id,
        manifest.device_type,
        manifest.category,
        manifest.license
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [assetQuery, deviceAssets, deviceType]);

  return (
    <aside data-component="DeviceNavigator" aria-label={language === 'zh' ? '安全预演设置' : 'Safe rehearsal setup'} className="flex h-full w-[240px] shrink-0 flex-col overflow-hidden border-r border-border bg-surface xl:w-[280px]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex min-h-[52px] flex-none flex-col justify-center border-b border-border px-3">
          <div className="rw-text-title text-text-primary">{language === 'zh' ? '安全预演' : 'Safe Rehearsal'}</div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.13em] text-simulation">
            {language === 'zh' ? '仅仿真 · 不发送硬件信号' : 'Simulation only · no hardware signal'}
          </div>
        </header>

        <div className="grid h-10 flex-none grid-cols-2 border-b border-border bg-surface p-1" role="tablist" aria-label={language === 'zh' ? '左侧导航' : 'Left navigation'}>
          {(['devices', 'assets'] as const).map((section, index, sections) => (
            <button
              key={section}
              id={`device-navigator-tab-${section}`}
              type="button"
              role="tab"
              aria-selected={activeSection === section}
              aria-controls={`device-navigator-panel-${section}`}
              tabIndex={activeSection === section ? 0 : -1}
              onClick={() => setActiveSection(section)}
              onKeyDown={(event) => handleRovingTabKey(event, index, sections.length, (nextIndex) => setActiveSection(sections[nextIndex]))}
              className={`border px-2 text-[13px] font-semibold ${activeSection === section ? 'border-border-strong bg-surface-raised text-text-primary' : 'border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary'}`}
            >
              {section === 'devices'
                ? (language === 'zh' ? '设置' : 'Setup')
                : (language === 'zh' ? '仿真模型库' : 'Model Library')}
            </button>
          ))}
        </div>

        <section id="device-navigator-panel-devices" aria-labelledby="device-navigator-tab-devices" hidden={activeSection !== 'devices'} className={`${activeSection === 'devices' ? 'grid' : 'hidden'} custom-scrollbar min-h-0 flex-1 content-start gap-3 overflow-y-auto px-3 py-3`} role="tabpanel">
          <div className="rounded-[3px] border border-simulation/40 bg-[#0B2233] px-2 py-2 text-[11px] leading-4 text-[#BAE6FD]">
            {language === 'zh'
              ? '仿真实验室没有真机控制。进入这里会断开任何 REAL 会话并清空真机遥测；结果只用于理解指令、动作与风险，不代表真实环境已安全。'
              : 'Simulation Lab has no hardware controls. Entering it disconnects any REAL session and clears REAL telemetry; results explain commands, motion, and risk but never prove the physical world safe.'}
          </div>
          <div>
            <FieldLabel><span className="mr-1 text-simulation">1</span>{language === 'zh' ? '目标类型' : 'Target kind'}</FieldLabel>
            <div className="relative">
              <select value={deviceType} onChange={(event) => onDeviceTypeChange(event.target.value as DeviceType)} className={selectClassName}>
                {deviceTypes.map((type) => (
                  <option key={type} value={type}>{deviceTypeOptionLabel(type)}</option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>

          <div>
            <FieldLabel><span className="mr-1 text-simulation">2</span>{language === 'zh' ? '仿真模型' : 'Simulation model'}</FieldLabel>
            <div className="relative">
              <select value={selectedProfileId} onChange={(event) => onProfileChange(event.target.value)} className={selectClassName}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profileOptionLabel(profile)}</option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>

          <div>
            <FieldLabel><span className="mr-1 text-simulation">3</span>{language === 'zh' ? '测试用例' : 'Test case'}</FieldLabel>
            <div className="relative">
              <select value={scenarios.length > 0 ? selectedScenarioId : '__coming_soon__'} onChange={(event) => onScenarioChange(event.target.value)} disabled={scenarios.length === 0} className={`${selectClassName} disabled:cursor-not-allowed disabled:opacity-60`}>
                {scenarios.length === 0 ? (
                  <option value="__coming_soon__">{`${t(language, 'scenario_not_implemented')} · ${t(language, 'support_coming_soon')}`}</option>
                ) : scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenarioLabel(scenario)}</option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>
          <div className="border-t border-border pt-3">
          {/* Collapsed by default (UI audit C1): this block is explanatory,
              not operational - one summary line, details on demand. */}
          <details>
            <summary className="flex cursor-pointer select-none items-center justify-between text-[11px] font-bold uppercase tracking-wide text-text-secondary hover:text-text-primary">
              <span>{language === 'zh' ? '仿真支持范围' : 'Simulation support'}</span>
              <span className={`ml-2 rounded-[3px] border px-1.5 py-0.5 font-bold normal-case ${selectedDeviceRunnable ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>
                {selectedDeviceRunnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
              </span>
            </summary>
          <div className="mt-2 grid gap-2 rounded-[3px] border border-border-panel bg-[#181A1D] p-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'supported_now')}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(['robot_arm', 'smart_light', 'camera_sensor'] as DeviceType[]).map((type) => (
                  <span key={type} className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[11px] font-semibold text-[#38BDF8]">
                    {localizeDeviceType(language, type)}
                  </span>
                ))}
              </div>
            </div>
            <div className="border-t border-border-panel pt-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'current_selection')}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="truncate text-[13px] font-semibold text-text-primary">{localizeDeviceType(language, deviceType)}</div>
                <span className={`rounded-[3px] border px-1.5 py-0.5 text-[11px] font-bold ${selectedDeviceRunnable ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>
                  {selectedDeviceRunnable ? t(language, 'support_supported') : t(language, 'support_coming_soon')}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-text-muted">{t(language, 'support_note')}</div>
            </div>
            <div className="border-t border-border-panel pt-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{t(language, 'workspace_focus')}</div>
              <div className="mt-1 text-[11px] leading-4 text-text-primary">
                <span className="font-semibold text-text-secondary">{t(language, 'active_workspace_device')}:</span>{' '}
                <span className="font-semibold">{selectedWorkspaceDeviceLabel ?? '-'}</span>
              </div>
            </div>
          </div>
          </details>
          </div>
        </section>

        <section data-component="AssetLibrary" id="device-navigator-panel-assets" aria-labelledby="device-navigator-tab-assets" hidden={activeSection !== 'assets'} className={`${activeSection === 'assets' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col px-3 py-3`} role="tabpanel">
          <div className="mb-2 rounded-[3px] border border-border-panel bg-[#181A1D] px-2 py-1.5 text-[11px] leading-4 text-text-muted">
            {t(language, 'asset_library_note')}
            <div className="mt-1 text-[11px] text-[#9AA3AF]">{t(language, 'workspace_drag_hint')}</div>
          </div>
          <input
            value={assetQuery}
            onChange={(event) => setAssetQuery(event.target.value)}
            className="mb-2 h-7 w-full rounded-[3px] border border-[#313338] bg-[#111214] px-2 text-[11px] text-[#E6EAF0] outline-none placeholder:text-[#5F6670] focus:border-[#0284C7]"
            placeholder={t(language, 'search_assets')}
          />
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-1">
            {filteredAssets.map((asset) => {
              const runnable = isRunnableDeviceV01(asset.manifest.device_type);
              const selectedAsset = asset.manifest.asset_id === selectedWorkspaceAssetId;
              return (
              <button
                key={asset.manifest.asset_id}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/open-reality-device-type', asset.manifest.device_type);
                  event.dataTransfer.setData('application/open-reality-asset-id', asset.manifest.asset_id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAddAsset(asset.manifest.asset_id)}
                title={localizeDisplayName(language, asset.manifest.display_name)}
                className={`group grid min-h-[66px] grid-cols-[32px_1fr_auto] gap-2 rounded-[3px] border p-1.5 text-left transition-colors hover:bg-[#24272C] ${selectedAsset ? 'border-[#075985] bg-[#162330]' : 'border-border-panel bg-bg-panel'}`}
              >
                <div className="relative h-8 w-8 overflow-hidden rounded-[3px] border border-border-panel bg-[#232529]">
                  <div className="absolute bottom-1 left-1 right-1 h-2 bg-[#4B5563]" />
                  <div className="absolute left-1.5 top-2 h-4 w-5 border border-[#6B7280] bg-[#9CA3AF]" />
                  <div className="absolute right-1 top-1.5 h-5 w-1.5 bg-[#374151]" />
                  <div className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold leading-4 text-text-primary">{localizeDisplayName(language, asset.manifest.display_name)}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-text-secondary">
                    {localizeDeviceType(language, asset.manifest.device_type)} / {localizeCategory(language, asset.manifest.category)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <span className={`rounded-[3px] border px-1.5 py-0.5 text-[11px] font-semibold ${runnable ? 'border-status-executed-edge bg-status-executed-surface text-status-executed-soft' : 'border-status-warning-edge bg-status-warning-surface text-status-warning'}`}>
                      {runnable ? t(language, 'asset_runtime_supported') : t(language, 'asset_runtime_asset_only')}
                    </span>
                    <span className="rounded-[3px] border border-border-panel bg-[#232529] px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">{t(language, 'sim')}</span>
                    <span className="rounded-[3px] border border-border-panel bg-[#232529] px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">{t(language, 'risk')} {localizeMetadataValue(language, asset.manifest.risk_class ?? 'medium')}</span>
                    <span className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[11px] font-semibold text-[#38BDF8]">{t(language, 'license')}</span>
                  </div>
                </div>
                <div className="self-center justify-self-end text-right">
                  <div className="rounded-[3px] border border-[#075985] bg-[#0B2233] px-1.5 py-0.5 text-[11px] font-bold text-[#38BDF8]">
                    {t(language, 'add_to_workspace')}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-text-muted">
                    {t(language, 'drag_to_workspace')}
                  </div>
                </div>
              </button>
              );
            })}
            {filteredAssets.length === 0 && (
              <div className="border border-dashed border-border-panel bg-[#181A1D] px-2 py-4 text-center text-[11px] text-text-secondary">
                {t(language, 'no_assets_found')}
              </div>
            )}
            </div>
          </div>
        </section>

        <details className="flex-none border-t border-border px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            {language === 'zh' ? '构建边界' : 'Build boundaries'}
          </summary>
          {/* Conformance boundary copy: Developer Preview / Not for production hardware */}
          <div className="mt-2 text-[12px] font-semibold text-text-primary">{t(language, 'developer_preview')}</div>
          <div className="mt-1 text-[12px] leading-4 text-text-secondary">{t(language, 'not_for_production')}</div>
        </details>
      </div>
    </aside>
  );
}

'use client';

import type { UiLanguage } from './LabConfigurator';
import { SemanticDeviceStage } from './SemanticDeviceStage';
import { StageErrorBoundary } from './StageErrorBoundary';
import type { RealHardwareTelemetry } from '@/types/realHardwareTelemetry';

export function RealDeviceWorkspace({ language, telemetry }: { language: UiLanguage; telemetry: RealHardwareTelemetry }) {
  const zh = language === 'zh';

  return (
    <main data-component="RealDeviceWorkspace" className="relative flex h-full min-w-0 flex-1 overflow-hidden border-r border-border-panel bg-bg-workspace">
      <StageErrorBoundary language={language}>
        <SemanticDeviceStage deviceType="robot_arm" state={{}} blocked={false} language={language} realHardwareTelemetry={telemetry} workspaceDevices={[]} />
      </StageErrorBoundary>

      <div className="pointer-events-none absolute left-4 top-4 z-20 border-2 border-status-warning-edge bg-black/95 px-3 py-2 font-mono text-status-warning [box-shadow:inset_0_0_0_1px_#FACC15]">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em]">REAL DEVICE WORKSPACE</div>
        <div className="mt-1 text-[11px] normal-case tracking-normal text-[#FDE68A]">
          {telemetry.connected
            ? (zh ? '已连接 · 这里只显示只读真机回显' : 'Connected · read-only real-device feedback')
            : (zh ? '未连接 · 不显示过期真机数据' : 'Disconnected · stale real-device data is hidden')}
        </div>
      </div>

      {!telemetry.connected && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8">
          <div className="max-w-[520px] border border-status-warning-edge bg-black/80 px-6 py-5 text-center">
            <div className="text-[18px] font-semibold text-text-primary">{zh ? '连接真实设备开始' : 'Connect a real device to begin'}</div>
            <div className="mt-2 text-[13px] leading-5 text-text-secondary">
              {zh
                ? '在右侧 REAL HARDWARE 边界中选择端口、诊断并连接。连接前这里不会放置虚拟设备，也不会产生任何硬件信号。'
                : 'Select a port, diagnose, and connect inside the REAL HARDWARE boundary on the right. No virtual device is placed here and no hardware signal is produced before connection.'}
            </div>
          </div>
        </div>
      )}

      {telemetry.connected && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[430px] border border-status-warning-edge bg-black/90 px-3 py-2 text-[11px] leading-4 text-[#FDE68A]">
          {zh
            ? '3D 对象是只读真机孪生体。所有指令、示教和回放仍只从右侧 REAL HARDWARE 边界进入既有安全门。'
            : 'The 3D object is a read-only real-device twin. Commands, teach, and replay still enter only through the existing gate in the REAL HARDWARE boundary.'}
        </div>
      )}
    </main>
  );
}

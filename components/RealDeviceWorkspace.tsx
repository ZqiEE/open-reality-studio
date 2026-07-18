'use client';

import type { UiLanguage } from './LabConfigurator';
import { SemanticDeviceStage } from './SemanticDeviceStage';
import { StageErrorBoundary } from './StageErrorBoundary';
import type { RealHardwareTelemetry } from '@/types/realHardwareTelemetry';

export function RealDeviceWorkspace({
  language,
  telemetry,
  onFocusRealHardware,
}: {
  language: UiLanguage;
  telemetry: RealHardwareTelemetry;
  onFocusRealHardware: () => void;
}) {
  const zh = language === 'zh';

  return (
    <main
      data-component="RealDeviceWorkspace"
      data-real-device-state={telemetry.connected ? 'connected' : 'disconnected'}
      className="relative flex h-full min-w-0 flex-1 overflow-hidden border-r border-border-panel bg-bg-workspace"
    >
      {telemetry.connected ? (
        <div data-real-twin-stage className="relative h-full w-full">
          <StageErrorBoundary language={language}>
            <SemanticDeviceStage deviceType="robot_arm" state={{}} blocked={false} language={language} realHardwareTelemetry={telemetry} workspaceDevices={[]} />
          </StageErrorBoundary>

          <div className="pointer-events-none absolute left-4 top-4 z-20 border-2 border-status-warning-edge bg-black/95 px-3 py-2 font-mono text-status-warning [box-shadow:inset_0_0_0_1px_#FACC15]">
            <div className="text-[12px] font-bold uppercase tracking-[0.16em]">REAL · READ-ONLY TWIN</div>
            <div className="mt-1 text-[11px] normal-case tracking-normal text-[#FDE68A]">
              {zh ? '已连接 · 当前真机回流，非仿真模型' : 'Connected · current real-device feedback, not a simulation model'}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[430px] border border-status-warning-edge bg-black/90 px-3 py-2 text-[11px] leading-4 text-[#FDE68A]">
            {zh
              ? '只读真机孪生体；最后指令角度为开环回显，并非实测位置。指令、示教和回放仍只从右侧 REAL HARDWARE 安全门进入。'
              : 'Read-only REAL twin. Last command angle is open-loop feedback, not measured position. Command, teach, and replay still enter only through the REAL HARDWARE gate on the right.'}
          </div>
        </div>
      ) : (
        <section data-real-device-onboarding aria-labelledby="real-device-onboarding-title" className="flex h-full w-full items-center justify-center bg-surface px-8">
          <div className="w-full max-w-[650px] border border-border-panel bg-surface-raised shadow-2xl">
            <div className="flex items-center justify-between border-b-4 border-status-warning-edge bg-black px-5 py-3">
              <div className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-status-warning">REAL DEVICE · DISCONNECTED</div>
              <div className="text-[11px] font-semibold text-text-muted">{zh ? '无 3D 舞台 · 无过期数据' : 'NO 3D STAGE · NO STALE DATA'}</div>
            </div>
            <div className="px-6 py-7 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-status-warning">{zh ? '真实设备工作区' : 'REAL DEVICE WORKSPACE'}</p>
              <h1 id="real-device-onboarding-title" className="mt-2 text-[24px] font-semibold text-text-primary">{zh ? '先让真实设备上线' : 'Bring the real device online first'}</h1>
              <p className="mt-3 max-w-[560px] text-[13px] leading-6 text-text-secondary">
                {zh
                  ? '接好参考设备后，在右侧点击“自动检测”。系统只读扫描串口：已有固件则诊断并连接；空白或无响应的新板则进入受控首次烧录。'
                  : 'Plug in the reference device, then choose Auto-detect on the right. RealityWarden scans ports read-only: existing firmware is diagnosed and connected; a blank or unresponsive board enters governed first flash.'}
              </p>
              <ol className="mt-6 grid grid-cols-3 gap-3" aria-label={zh ? '真实设备连接步骤' : 'Real-device connection steps'}>
                {[
                  zh ? '插入参考设备' : 'Plug in reference rig',
                  zh ? '点击自动检测' : 'Choose Auto-detect',
                  zh ? '连接或准备首次烧录' : 'Connect or prepare first flash',
                ].map((label, index) => (
                  <li key={label} className="border border-border bg-surface px-3 py-3 text-[12px] text-text-secondary">
                    <span className="mr-2 font-mono font-bold text-status-warning">{index + 1}</span>{label}
                  </li>
                ))}
              </ol>
              <button type="button" onClick={onFocusRealHardware} className="mt-6 h-10 border border-status-warning-edge bg-status-warning-surface px-4 text-[13px] font-semibold text-status-warning focus:outline-none focus:ring-2 focus:ring-status-warning">
                {zh ? '前往自动检测' : 'Go to Auto-detect'}
              </button>
              <p className="mt-3 text-[11px] leading-4 text-text-muted">
                {zh
                  ? '自动检测是只读操作，不会驱动舵机。也可刷新端口后手动选择并连接。'
                  : 'Auto-detect is read-only and never moves the servo. You can also refresh, select a port, and connect manually.'}
              </p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

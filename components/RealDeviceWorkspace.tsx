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
                  ? '这里不是仿真区。未连接时不渲染 3D 网格、虚拟设备或伪造遥测；连接成功后，才显示只读 REAL 孪生体。'
                  : 'This is not a simulation surface. While disconnected, no 3D grid, virtual device, or invented telemetry is rendered. The read-only REAL twin appears only after connection.'}
              </p>
              <ol className="mt-6 grid grid-cols-3 gap-3" aria-label={zh ? '真实设备连接步骤' : 'Real-device connection steps'}>
                {[
                  zh ? '选择端口' : 'Select port',
                  zh ? '诊断设备' : 'Diagnose',
                  zh ? '显式连接' : 'Connect explicitly',
                ].map((label, index) => (
                  <li key={label} className="border border-border bg-surface px-3 py-3 text-[12px] text-text-secondary">
                    <span className="mr-2 font-mono font-bold text-status-warning">{index + 1}</span>{label}
                  </li>
                ))}
              </ol>
              <button type="button" onClick={onFocusRealHardware} className="mt-6 h-10 border border-status-warning-edge bg-status-warning-surface px-4 text-[13px] font-semibold text-status-warning focus:outline-none focus:ring-2 focus:ring-status-warning">
                {zh ? '打开右侧设备控制' : 'Open device controls on the right'}
              </button>
              <p className="mt-3 text-[11px] text-text-muted">{zh ? '此操作只移动界面焦点，不会发送硬件信号。' : 'This only moves interface focus; it sends no hardware signal.'}</p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * SetupAdvisor: turns raw probe/connect failures and diagnose_hardware
 * responses into operator-facing identities and plain-language advice.
 *
 * Pure logic, no I/O — shared by the diagnose CLI, the electron bridge, and
 * the REAL HARDWARE panel so the troubleshooting knowledge base lives in ONE
 * place (docs/REAL_HARDWARE_ESP32.md is the long-form version of these rules).
 *
 * Honesty rules apply: advice never claims more certainty than the signal
 * supports, and an unknown failure is surfaced verbatim, never swallowed.
 */

export interface FirmwareIdentity {
  firmware: string | null;
  firmwareVersion: string | null;
  protocolVersion: number | null;
  sensorInterface: string | null;
  sensorModel: string | null;
  /** true when the device answers the protocol but predates diagnose_hardware. */
  legacy: boolean;
  /** true when the firmware reports a device-side clock (audit 2.2 ready). */
  reportsDeviceMs: boolean;
}

export type AdviceSeverity = 'ok' | 'warning' | 'error';

export interface SetupAdvice {
  code: string;
  severity: AdviceSeverity;
  zh: string;
  en: string;
}

export const EXPECTED_FIRMWARE = 'realitywarden-esp32';
/** The version the prebuilt one-click flash image ships (pulse-width HC-SR04). */
export const EXPECTED_FIRMWARE_VERSION = '0.1.4';
/**
 * Every firmware version the current host accepts. 0.1.5 is the source build
 * with the compile-time pulse_width / serial_ttl (IOE-SR05) sensor selection;
 * it speaks the same protocol 4.
 */
export const EXPECTED_FIRMWARE_VERSIONS: readonly string[] = ['0.1.4', '0.1.5'];

function advice(code: string, severity: AdviceSeverity, zh: string, en: string): SetupAdvice {
  return { code, severity, zh, en };
}

/** Classify a connect/open/probe failure string into actionable advice. */
export function adviceForFailure(errorText: string): SetupAdvice {
  const text = errorText.toLowerCase();
  if (text.includes('sha256') || text.includes('companion_rejected') || text.includes('paired_image_missing')) {
    return advice('firmware_image_rejected', 'error',
      '已审固件镜像或其 SHA-256 配对文件缺失/不一致。不要继续烧录；重新安装当前 RealityWarden 版本以恢复仓库随附镜像，然后重新核对摘要。',
      'The reviewed firmware image or its SHA-256 companion is missing or inconsistent. Do not continue flashing; reinstall this RealityWarden release to restore its bundled image, then review the digest again.');
  }
  if (text.includes('target chip rejected')) {
    return advice('firmware_wrong_chip', 'error',
      '检测到的芯片不是已审镜像要求的 ESP32-S3。不要强刷或换用任意镜像；核对开发板型号与所选串口。',
      'The detected chip is not the ESP32-S3 required by the reviewed image. Do not force the flash or substitute another image; verify the board model and selected port.');
  }
  if (text.includes('flash failed') || text.includes('automatic reconnect/diagnose failed') || text.includes('diagnose did not verify firmware')) {
    return advice('firmware_flash_failed', 'error',
      '烧录未得到完整验证，系统没有自动重试。保持设备静止，检查数据线与供电，确认选择的是板载 COM/UART 口；重新连接后核对 diagnose，再由操作者决定是否重新烧录。',
      'The flash was not fully verified and was not retried. Keep the rig still, check the data cable and power, and confirm the board COM/UART port; reconnect and inspect diagnose before the operator decides whether to flash again.');
  }
  if (text.includes('serialport_not_installed')) {
    return advice('serialport_missing', 'error',
      '缺少串口驱动包：在应用目录执行 npm install（会安装 serialport）后重启应用。',
      'Serial driver package missing: run npm install in the app directory (installs serialport), then restart the app.');
  }
  if (text.includes('access denied') || text.includes('resource busy') || text.includes('permission denied') || text.includes('in use')) {
    return advice('port_busy', 'error',
      '串口被其他程序占用：关闭 Arduino IDE 的串口监视器、其他终端或上一次未退出的诊断进程后重试。',
      'The port is held by another program: close the Arduino IDE serial monitor, other terminals, or a previous diagnostic process, then retry.');
  }
  if (text.includes('cannot find') || text.includes('not found') || text.includes('no such file') || text.includes('unknown port')) {
    return advice('port_gone', 'error',
      '找不到该串口：检查 USB 线（必须是数据线）、换个 USB 口，然后点"刷新/自动检测"。',
      'Port not found: check the USB cable (must be a data cable), try another USB port, then Refresh / Auto-detect.');
  }
  if (text.includes('timeout') || text.includes('handshake failed') || text.includes('no valid response')) {
    return advice('no_response', 'warning',
      '端口打开了但设备不应答。最常见原因：① ESP32-S3 有两个串口——烧录用 "COM/UART" 口，运行要连固件实际打印的口（USB CDC 开启时是原生 USB 口），换另一个口试试；② 供电不足（不要用会休眠的充电宝）；③ 波特率非 115200 或固件没在运行。',
      'Port opened but the device does not answer. Most common causes: (1) ESP32-S3 exposes two ports — flash via the "COM/UART" port but connect to the port the firmware prints on (native USB when USB-CDC is enabled); try the other one. (2) Insufficient power (avoid auto-sleeping power banks). (3) Wrong baud rate (must be 115200) or firmware not running.');
  }
  if (text.includes('no echo pulse')) {
    return advice('sensor_no_echo', 'warning',
      '设备在线但超声波传感器无回波：检查传感器 5V 供电（电源板跳线档位!）、与 ESP32 共地、TRIG→GPIO5、ECHO 经 1kΩ+2kΩ 分压→GPIO4，并在探头前 10–30cm 放一块硬板。',
      'Device online but the ultrasonic sensor returns no echo: check sensor 5V supply (power-board jumper!), common ground with the ESP32, TRIG->GPIO5, ECHO through a 1k+2k divider to GPIO4, and place a solid target 10-30cm in front.');
  }
  return advice('unknown_failure', 'error',
    `未识别的故障，原文：${errorText}。按 docs/REAL_HARDWARE_ESP32.md 的 Troubleshooting 自上而下排查。`,
    `Unrecognized failure: ${errorText}. Work top-down through Troubleshooting in docs/REAL_HARDWARE_ESP32.md.`);
}

/**
 * Interpret a diagnose_hardware response (or its absence) into a firmware
 * identity + advice list. `diagnoseData` is the device's data payload when
 * diagnose_hardware succeeded; `legacyReadOk`/`legacyDeviceMs` describe the
 * read_distance fallback used against firmware that predates diagnostics.
 */
export function interpretProbe(input: {
  diagnoseOk: boolean;
  diagnoseData?: Record<string, unknown>;
  diagnoseError?: string;
  legacyReadOk?: boolean;
  legacyDeviceMs?: boolean;
}): { identity: FirmwareIdentity | null; advice: SetupAdvice[] } {
  const items: SetupAdvice[] = [];

  if (input.diagnoseOk && input.diagnoseData) {
    const data = input.diagnoseData;
    const identity: FirmwareIdentity = {
      firmware: typeof data.firmware === 'string' ? data.firmware : null,
      firmwareVersion: typeof data.firmwareVersion === 'string' ? data.firmwareVersion : null,
      protocolVersion: typeof data.protocolVersion === 'number' ? data.protocolVersion : null,
      sensorInterface: typeof data.sensorInterface === 'string' ? data.sensorInterface : null,
      sensorModel: typeof data.sensorModel === 'string' ? data.sensorModel : null,
      legacy: false,
      reportsDeviceMs: typeof data.deviceMs === 'number'
    };
    if (identity.firmware !== EXPECTED_FIRMWARE) {
      items.push(advice('foreign_device', 'warning',
        `设备应答了协议但不是 RealityWarden 固件（上报：${identity.firmware ?? '未知'}）。确认选对了设备。`,
        `The device speaks the protocol but is not RealityWarden firmware (reports: ${identity.firmware ?? 'unknown'}). Confirm you picked the right device.`));
      return { identity, advice: items };
    }
    if (identity.firmwareVersion === null || !EXPECTED_FIRMWARE_VERSIONS.includes(identity.firmwareVersion)) {
      items.push(advice('firmware_outdated', 'warning',
        `固件版本 ${identity.firmwareVersion ?? '未知'}，期望 ${EXPECTED_FIRMWARE_VERSIONS.join(' 或 ')}。打开右侧“固件”任务，核对端口、版本和 SHA-256 后烧录已审镜像。`,
        `Firmware ${identity.firmwareVersion ?? 'unknown'}, expected ${EXPECTED_FIRMWARE_VERSIONS.join(' or ')}. Open the Firmware task, verify port, version, and SHA-256, then flash the reviewed image.`));
    }
    if (!identity.reportsDeviceMs) {
      items.push(advice('no_device_clock', 'error',
        '固件未上报设备侧时钟 deviceMs：安全门会拦截一切执行（audit 2.2 防护）。请在右侧“固件”任务中烧录最新已审镜像。',
        'Firmware does not report the device-side clock (deviceMs): the safety gate blocks all actuation (audit 2.2). Flash the latest reviewed image from the Firmware task.'));
    }
    const echoes = typeof data.successfulEchoes === 'number' ? data.successfulEchoes : null;
    if (identity.sensorInterface === 'pulse_width' && echoes === 0) {
      items.push(adviceForFailure('no echo pulse'));
    }
    if (items.length === 0) {
      items.push(advice('ready', 'ok',
        `RealityWarden v${identity.firmwareVersion} 就绪：传感器 ${identity.sensorModel ?? '未知'}（${identity.sensorInterface ?? '?'}），设备时钟正常。可以直接跑验收。`,
        `RealityWarden v${identity.firmwareVersion} ready: sensor ${identity.sensorModel ?? 'unknown'} (${identity.sensorInterface ?? '?'}), device clock present. Acceptance can run now.`));
    }
    return { identity, advice: items };
  }

  // diagnose_hardware failed or unsupported: probe legacy firmware behavior.
  if (input.diagnoseError && input.diagnoseError.includes('unsupported cmd')) {
    const identity: FirmwareIdentity = {
      firmware: EXPECTED_FIRMWARE,
      firmwareVersion: null,
      protocolVersion: null,
      sensorInterface: null,
      sensorModel: null,
      legacy: true,
      reportsDeviceMs: input.legacyDeviceMs === true
    };
    items.push(identity.reportsDeviceMs
      ? advice('legacy_but_clocked', 'warning',
        '旧版固件（无诊断命令）但已带设备时钟。建议从右侧“固件”任务升级已审镜像以获得诊断能力。',
        'Legacy firmware (no diagnostic commands) but the device clock is present. Upgrade the reviewed image from the Firmware task to add diagnostics.')
      : advice('legacy_no_clock', 'error',
        '旧版固件且无设备时钟 deviceMs：安全门会拦截一切执行。必须从右侧“固件”任务烧录最新已审镜像。',
        'Legacy firmware without the device clock (deviceMs): the safety gate blocks all actuation. Flash the latest reviewed image from the Firmware task.'));
    return { identity, advice: items };
  }

  if (input.legacyReadOk) {
    // Answers read_distance but not diagnose and not a clean "unsupported cmd".
    items.push(advice('protocol_partial', 'warning',
      '设备部分应答协议但行为异常（read_distance 通、诊断失败且非 unsupported cmd）。建议重刷固件后重试。',
      'The device partially speaks the protocol (read_distance works, diagnose fails without a clean "unsupported cmd"). Reflash the firmware and retry.'));
    return { identity: null, advice: items };
  }

  items.push(adviceForFailure(input.diagnoseError ?? 'no valid response'));
  return { identity: null, advice: items };
}

# AGENTS.md — RealityWarden 交接说明(供 Codex / 任何 AI 代理)

你接手的是一个**接近成品**的桌面产品:自然语言/自定义动作 → 安全治理管线 → 3D 仿真或真实硬件(ESP32-S3 + SG90 舵机 + HC-SR04)。技术栈:Next.js + Electron + Three.js + TypeScript,本地 LLM 编译器(Ollama,离线回退规则引擎)。

**产品定位（2026-07-21 定死,唯一权威源 `docs/POSITIONING.md`）**:RealityWarden = AI 驱动机器的"黑匣子 + 门卫"——AI 与真实执行器之间的中立举证型安全网关,每个动作过门、可拒绝、有回执,回执可交给监管/保险/客户。开发优先级由一个问题决定:**"AI 想干什么、允许了吗、证据呢?"** 强化"门"和"回执"的工作优先;生态/市场/新设备族是第二章(见 `docs/ROADMAP.md` v0.6/v0.7)。

## 先读什么(按序,5 分钟)

1. `STATUS.md` — 当前状态、已完成清单、路线图。这是唯一权威进度源。
2. `docs/security/2026-07-09-invariant-audit.md` — 安全审计报告(头部有解决状态)。
3. `docs/ui/2026-07-11-ui-audit.md` — UI 审查(第 1、2 批已修,剩余标了"重构")。

## 🔴 红线(违反 = 事故,无例外)

六条安全不变量,有 46 条真机安全测试 + 5 条虚拟回环场景守着,**只能收紧不能放宽**:

1. **单一受控通路**:actuation 帧只能经 `HardwareExecutionGate` 走 ticket 路径(`lib/hardware/internal/actuation.ts` 是 gate 私有,ESLint 禁止外部 import;`SerialEsp32Transport.send()` 会拒绝 actuation 命令)。任何地方都不许手搓 `move_to_angle` 帧。
2. **默认拦截**:传感器数据缺失/过期/非法/冻结/缺设备时钟 ⇒ 拦截执行。互锁要求权威地长在 `ESP32_SERVO_RIG_CAPABILITIES` 里,调用方不能绕过。
3. **无静默回退**:一切降级显式、审计、可见。
4. **诚实审计**:每条决策带 `hardwareSignalSent` 布尔,不许伪造。
5. **提案者不可信**:越界拒绝,永不钳制(clamp)。LLM 输出、Action Manifest、用户输入全是不可信数据。
6. **仿真与真实可见区分**:真实执行永远标 `real_hardware`。

**测试断言不许为了让测试通过而放宽。** 改安全层(`lib/hardware/`、`lib/runtime/SafetyMonitor.ts`)前先陈述影响再动手。

## 每次改动后的验证(不可跳过)

```bash
npx tsc -p tsconfig.json --noEmit        # 根项目
npx tsc -p tsconfig.next.json --noEmit   # app + components
npx tsc -p electron/tsconfig.json --noEmit
npm run test:real-hardware               # 46 条安全不变量,必须全绿
npm run test:virtual-loopback            # 全链路 e2e(5 场景)
node lib/desktop/runDesktopTests.js      # 含 IPC 契约断言
node lib/conformance/runConformance.js   # 产品契约(断言源码字符串,改 UI 前先查)
npm run verify                           # 全量(慢,提交前跑一次)
```

注意:`lib/conformance/runConformance.js` 和 `lib/desktop/runDesktopTests.js` 会**对源码文件做字符串断言**(page.tsx、preload.ts、hardware.ipc.ts 等)。删改 UI 元素前先 grep 这两个文件;设计变更允许同步更新断言,但必须保护等价或更强,并在提交信息里说明。

## 架构要点(踩过坑的)

- **electron 主进程不能直接 import lib/**(tsconfig rootDir 限制)。真机执行链是 `scripts/build-electron.cjs` 把根项目编译到 `dist-electron-runtime/`,`electron/ipc/hardware.ipc.ts` 运行时 require——与 CLI/测试同一份代码,不许复制协议逻辑。
- **UI 真机执行有证据锁**:`docs/acceptance/evidence/` 集齐 4 份 JSON 才解锁(`real_execution_locked`),或 `ORS_REAL_EXECUTION=enabled`。这个锁不许拆。
- **preload.ts 不许出现子串 `fs`**(desktop 测试断言,连 "offset" 这种词都会踩雷)。
- **测试套件大多是"编译到临时目录再跑"**:`npx tsc -p tsconfig.json --outDir <tmp> --module commonjs --moduleResolution node --noEmit false`,tsc 不重写 `@/` 别名,但 lib 子图的 `@` import 全是 type-only,编译产物可直接 node 运行。
- Windows 开发:`npm run dev` 走 `.next-dev` 独立目录(防锁 `.next-build`);`npm run build` 的清理脚本用 powershell(Linux 下跑不了)。

## ⚠️ 已知运维风险

- **不要多个 AI 会话同时写这个仓库**。历史上并发写入造成:源文件截断 ×3、git index 损坏 ×5、未提交编辑被 restore 抹掉 ×1。如果 `git status` 和文件实际内容矛盾,用 `git hash-object <file>` 对比 `git rev-parse HEAD:<file>` 验证,重建 index:`rm -f .git/index && git read-tree HEAD`。
- 固件预编译镜像 `firmware/prebuilt/*.merged.bin` 有 sha256 companion,烧录脚本校验不过会拒绝——重编固件后必须同步更新 bin+sha256。

## 当前进度与下一步(2026-07-14 所有者指示)

**持续开发到成品，不等待真机验收。** 真机四场景仅是可选硬件证据，永远不得作为开发、功能解锁或发布工程的阻塞条件。六条安全不变量、证据锁和全部自动验证要求保持不变。

已完成:安全审计 1.1/2.1/2.2/3.1/x.1/x.2 全修;零配置设备接入(自动检测+SetupAdvisor);一键烧录;UI 真机执行路径(证据锁);虚拟回环 e2e;UI 减重两批;v0.4 Action Composer(自定义动作,同管线);Windows NSIS 安装包(共享安全运行时+固件+serialport 原生绑定,安装态烟测通过)。

所有者指示的方向(按优先级):
1. **安装包打包 ✅**:electron-builder 产出 Windows 安装包,把 `dist-electron-runtime`、`firmware/prebuilt`、serialport 原生模块打进产物;版本号、图标;构建后自动验包并跑过安装态 smoke。
2. **UI 信息架构重构**(`docs/ui/2026-07-11-ui-audit.md` C 系列剩余项 + E 系列视觉一致性:设计 token 收敛、字号层级)。
3. v0.4 深化:动作库导入/导出(JSON,已有 schema)、禁区(forbidden_zones)在 3D 工作区可视化编辑。
4. **v0.3.0 发布收口 ✅**:版本、发布说明、试用/评估文档与路线图已对齐；`RealityWarden-0.3.0-Setup.exe` 已通过包内容、版本资源与安装态 smoke。
5. **v0.4 传感器 polling/subscription ✅**:每个真实硬件基元动作前取得新一代传感器证据；读失败立即清空证据，设备时钟倒退/冻结显式锁存；多步动作首个 blocked/failed/cancelled 后零后续帧。
6. **v0.4 三设备参考 recipe ✅**:Robot Arm / Smart Light / Camera Sensor recipe 经同一 Manifest validator 与仿真安全链；智能灯 typed value 不再丢参，跨设备/无策略参数默认拒绝；Action Composer 可载入匹配 recipe。
7. **【当前最高优先级】v0.6 "回执"里程碑（2026-07-21 定位定死后的英雄功能）**:
   a) 一键导出签名审计报告(时间范围内全部提案/决策/规则触发/拒绝/人工确认/`hardwareSignalSent`,PDF 人读 + JSON 机读,内容哈希防篡改);
   b) 首屏叙事重排为"意图 → 门 → 结果 + 回执",拒绝是可展示的正向状态而非报错;
   c) 审计记录 schema 冻结(只允许增量扩展),供外部消费方对接;
   d) 易用/透明打磨:安装到发出受治理命令 <5 分钟、每个状态有人话解释、无死胡同(被拦截时说清发生了什么和下一步)。
   验收:新用户不读文档即可完成"受治理命令 + 触发一次拒绝 + 导出签名报告"。
8. **v0.5 手册/PDF simulation-only 闭环 ✅**:File 菜单导入文本层 PDF/Markdown/文本，本地 Ollama 只生成不可信草案；来源对照/JSON/原始输出、语义几何预览、首次人工复核与 Virtual Lab 二次启用门齐全。DeviceProfile 和生成资产固定 simulator-only，模板不扩大能力，篡改/孤儿记录加载时显式拒绝。下一步优先做成品化文档、安装包验包、可访问性与错误恢复，再做手册动作显式安装审阅。

git:提交按功能单元、message 说明验证结果;所有者本机负责 push。

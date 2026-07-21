# STATUS — 当前权威状态

更新：2026-07-21。历史工作日志已完整归档到 `docs/HISTORY.md`（只增不改）。
接手前先读：本文件 → `docs/POSITIONING.md`（定位，已定死）→ `AGENTS.md`（红线与验证）。

## 定位（2026-07-21 定死）

**RealityWarden = AI 驱动机器的"黑匣子 + 门卫"：AI 与真实执行器之间的中立举证型
安全网关。每个动作过门、可拒绝、有回执；回执可交给监管、保险公司和客户。**

一切开发以一个问题为判据：**"AI 想干什么、允许了吗、证据呢？"**
生态（协议/SDK/Marketplace）为第二章，见 `docs/ROADMAP.md`。

## 当前版本

- **v0.5.1 Public Alpha**（Windows NSIS 安装包链路、发布证据链、供应链门禁全部闭环，
  详见 `docs/HISTORY.md`）。
- 安全基线：六不变量（`lib/governance/invariants.ts`，测试映射守护）；
  真机安全套件 48/48 + 虚拟回环 5/5 + 快速门 47/47 全绿。
- 真机边界不变：唯一 ticket 通路、证据锁、逐次人工确认、诚实 `hardwareSignalSent`。

## v0.6 "回执"里程碑（当前主线，2026-07-21 起）

已完成：

- ✅ 回执核心 `lib/receipt/AuditReceipt.ts`：`realitywarden.receipt/v1`（已冻结，
  additive-only），确定性规范化 + SHA-256 防篡改哈希 + 独立校验 + 人读渲染；
  不一致证据拒绝公证。
- ✅ 仿真侧导出：工具栏"导出审计回执"（JSON + Markdown + HTML）。
- ✅ REAL 真机侧导出：每次门控执行诚实入账（证据缺失保守记 `attempted_unconfirmed`，
  绝不伪造 not_sent），面板一键导出会话回执。
- ✅ 格式规范 `docs/RECEIPT_FORMAT.md`（写给回执消费方）+ 零依赖第三方校验器
  `scripts/verify-receipt.cjs`（`npm run receipt:verify`），跨实现哈希一致已验证。
- ✅ 合规映射 `docs/COMPLIANCE_MAPPING.md`（六不变量 → EU AI Act Art.9/12/13/14）。
- ✅ 测试：`test:receipt` 套件（核心 + REAL 映射 + HTML 渲染）接入 verify 链与 fast 快速门。

进行中 / 待做（按序）：

1. 首屏叙事重排：默认界面讲"意图 → 门 → 结果 + 回执"，拒绝是可展示的正向状态
   （顺手按 `docs/ui/2026-07-11-ui-audit.md` C/E 系列分批拆 `app/page.tsx`）。
2. 验收（v0.6 出口标准）：新用户不读文档，5 分钟内完成
   "受治理命令 → 触发一次拒绝 → 导出回执"。

## 仓库卫生（2026-07-21 清理）

- 已删除（经引用审计，全部零引用）：`lib/simulator/`、`components/VirtualWorkspace.tsx`、
  `lib/safety/safetyChecks.ts`、`constants/materials.ts`、6 份过期文档
  （v0.2 分诊、v0.3.0 发布件等）、根目录 15 个残留日志、2 个 .cmd 便捷脚本。
  物理文件在 `_to_delete/`（已被 git/tsc 排除），确认后可整体删除。
- 保留并有据：`SOCIAL_MEDIA_LAUNCH_PACK.md`（release 测试断言其归档标记）、
  `LLM_COMPILER_DRAFT.md` / `ACTION_MANIFEST_DRAFT.md`（有活引用）、
  `PRODUCT_VISION.md`（ROADMAP 引用的历史参考）。
- 已知技术债（有计划，不属删除对象）：`app/page.tsx` 单体（随首屏重排分批拆）；
  lib 内近义模块对（`adapter`/`adapter-sdk`、`protocol`/`open-reality-protocol`）
  属未来合并重构。

## 定位收敛（2026-07-21 二次)

- `package.json` description 由旧"Physical AI 仿真+参考硬件"改为锁定一句话
  (中立举证型安全网关:过门/可拒绝/有回执)。
- `docs/DEMO_SCRIPT.md`:Core Message、结尾卡片、开头字幕重排为"意图→门→
  拒绝→回执"领衔,"通用运行时/多设备可控"显式降级为第二章;门禁断言的
  REAL-first 边界句原样保留(release consistency 仍绿)。
- `docs/PRODUCT_VISION.md`:新增"Owner update (2026-07-21)"锚定,点明近期
  买家/叙事以 POSITIONING.md 为准,"for everyone"是长期目标、创客/ESP32 是入口。
- 仓库根 6 份未跟踪中文规划/评审草稿(与 canonical POSITIONING.md 竞争)已
  移出仓库到父目录 `../项目规划归档/`(可逆归档,内容未丢);仓库根现仅存
  AGENTS/CONTRIBUTING/README/SECURITY/STATUS。
- 验证:test:conformance 绿、runReleaseTests 绿(均不产临时目录)。完整
  `npm run verify` 需在 Windows 本机跑(build 清理依赖 PowerShell)。
- 待所有者本机执行的唯一物理删除(云沙箱禁 unlink,无法代删):
  `rm -rf _to_delete .tmp-project-file-test`(前者已被 gitignore/tsc/build
  排除,删不删不影响正确性,仅回收磁盘;后者为门禁临时目录)。

## 待决策（所有者）

- git push 由所有者本机执行；提交按功能单元、message 写明验证结果。
- 正式发行仍需：Official 目录公钥/HTTPS URL、Windows 代码签名证书、法律批准件
  （见 `docs/HISTORY.md` 发布门禁记录）。
- 真机证据可随时补充，不阻塞任何开发或发布工作。

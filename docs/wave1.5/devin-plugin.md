# Devin — Plugin 独立执行入口

Repository: https://github.com/Mahjong404/LoomTable-Obsidian-Plugin.git

本入口可在单独 Plugin clone 中执行。当前设计已批准，正式文档已准备；文档整理不等于生产切片或 API Gate 已获执行授权。每次输入必须指定 Task ID 与允许范围。

## 启动与首个任务

1. 读仓库 AGENTS.md、CONTRIBUTING.md、本目录 README 和 [status](status.md)，确认明确授权与未完成任务。没有同级工作区时，以仓库内这些文件为完整入口。
2. 读 [Master Plan](implementation-plan.md)、目标 [任务卡](task-specifications.md)、[追踪矩阵](traceability.md) 与涉及的 [API Boundary](api-boundary.md)。UI 任务按项目 Skill 路由到 DS/HIG/Grid；编辑器读 [生命周期](../architecture/field-editor-lifecycle.md)。
3. 检查 git status/diff、branch、实际 HEAD、未跟踪文件、package/lockfile、API pin；保留已有改动，不 reset/clean。审查已有 PR，避免重复实现已完成任务。
4. **首个文档工作是 W15-00 审查/发布已准备的基线，不再从本地目录重新迁移。** 文档 commit 提供后，获授权的首个生产切片为 W15-01：真实 Field/Menu/Toolbar 的 Primitive 语义、失败保 draft 和 owned overlay。
5. 在 status claim 一个 Ready 纵向切片，记录真实 base HEAD、owner/branch、前置、共享文件范围；完成实现、测试、review 与状态更新后再换包。

普通工程细节在现有合同内决定；新产品/API 语义按 Gate 停在依赖部分，继续其他获授权任务。不要继续 Figma 视觉探索、Motion 制作或工具扩展。

## 当前 API 不变时先交付的 UI

推荐主路径 **00 → 01 → 04 → 05 → 07 → 10 → 11**。02/03/09 在 01 后可独立模块推进；06、08A 在 Grid 基线稳定后集成；12 最后验收当前授权范围。

Date-only、现有 ID Choice、Filter/Sort/Display、Grid 几何与局部校验、连续加载、View/Rename、当前 Undo/读生命周期修复均不需要等待新 Server。API pin/generated 不变；无需为了这些 UI 拉取 Server HEAD 或运行 api:sync。

| API-dependent 部分                              | 等待条件                                      | 当前处理                                                |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| 新三色写入                                      | G1 合同/Server capability                     | 对齐原 9 色、保未知 reader 值                           |
| inline Choice create-and-select / Draft intents | G2 事务与 Queue 合同                          | 现有 ID 选择可用，不两请求伪原子                        |
| View order / 新 tail 持久化                     | G3 snapshot/CAS                               | 当前导航和 Rename 独立交付                              |
| Header 全 query 选择                            | G4 membership/scope                           | Current/Ctrl+A rectangle 保留，未提供能力明确 gated     |
| 最终 Operation Records 入口                     | G5 真实 Record projection/event-time/identity | 08A 安全修复先交付，08B 不标 Done                       |
| 非空 Search 的匹配 Aggregate                    | G6 Aggregate Search                           | 先标 unavailable，不显示 Filter-only/loaded-page 假总计 |
| Time/DateTime、12h、整 Table 回滚               | 对应 Future 正式合同                          | 不接字段持久化，不伪装已交付                            |

## Server 合同交付后才接入

收到一个 Gate 的明确授权、批准的领域/OpenAPI 合同、**40 位 Server commit SHA**、PR/测试、部署 capability/版本矩阵与回滚说明后：

1. 复查该 Gate 仍符合 [API Boundary](api-boundary.md)，确认其他 UI 切片不受影响。
2. 显式运行 pnpm api:sync approvedSHA，然后 pnpm api:generate；逐项审查 YAML、source.json 和 generated diff，generated 不手改。
3. 接入 HTTP decoder/client、InMemory 与必要 Controller/Queue schema；保持 expectedRevision、stable clientMutationId/body、未知结果与错误语义。新持久命令先做兼容与储存失败零 HTTP 验证。
4. Gate-specific tests 和旧新 Plugin × Server 矩阵通过后再启用消费者。Server 合并但尚未部署时保持安全 capability gate。
5. 在 status 分别记录 Server 合同/commit/实际 capability 与 Plugin PR/pin；不要把 Server 完成直接等同于 Plugin 交付。

## 文件所有权与并行

readonly-grid-renderer.ts、grid-view-controller.ts、其大型测试、styles.css、registry/product handle、i18n/Gallery 是共享热点，一次只有一个集成 owner。Filter/Sort/View 的局部模块或纯 date-only 数学可并行准备，核心 adapter 必须基于最新前置 PR 串行合并。

07 先验证一个窄 product handle，10/11 复用；不同 Session 不各建保存 coordinator 或 Date/Choice 协议。并行通过明确任务、文件范围、PR 依赖和 status 同步，不依赖聊天消息或复制共享组件。

## 每切片的检查与验收

- 先读真实源码/测试，定义接受一次请求、选择零写、late publish 零次、dispose 释放等可观察不变量；保留已正确回归。
- focused Vitest → package 当前规定的 typecheck/format/lint/test → 合并前 pnpm check 与 git diff --check。check 包含生成与 build，纯 UI 要求 API/generated diff 零；不提交 bundle/cache。
- pnpm gallery 构建真实生产 factory 场景。Light/Dark、长/空/错误/disabled、320–400/600/960 pane、200% zoom、hit/scroll/portal 颜色实际检查；不要复制独立 demo。
- Obsidian Desktop 验证任务关键路径、IME/keyboard/focus/Pointer/Popover/Sheet/reduced motion、资源释放与性能。CDP 可辅助，但执行不依赖忽略目录里的私人 driver。
- 实际 Mobile 可用时测试 touch/coarse/WebView/安全区/键盘遮挡；无设备记录未验证，不用 Desktop 仿真替代。
- 涉及 Server 的测试只用专用隔离合成环境，遵守仓库环境规则。没有专用 DB/权限时用 typed fixtures 验证 Plugin 并记录 Server 未测，不重置真实数据。

文档 W15-00 仅检查链接/锚点/覆盖/纯文档 diff；项目默认 prettier 忽略 docs，需对新文档显式用 --ignore-path .gitignore。不要为了文档跑会写产品生成文件的 pnpm check。

## PR、交接与完成

遵循 CONTRIBUTING 与现行 AGENTS，使用用途前缀短分支和一个可验证纵向切片的窄 PR。提交、推送、PR、合并和发布以明确用户授权及仓库工作流为准；执行指南本身不授予发布权限。使用项目规定的用户 Git 身份，不加工具生成 trailer。

PR 说明具体问题/新行为、Task/需求/正式权威、代码范围、实际检查与宿主限制、风险/回滚。随同更新 status/traceability；仅在模块真实创建后更新 source-layout。无研究内容、秘密、Vault、临时产物或无关 diff。

结束前记录实际完成、未解锁 Gate、PR/commit、验证和下一步。Done 必须达到任务 DoD；08A 不代表 08B，当前 Lane A 完成不表示全部 Future 业务交付。新 Session 从 status/PR/真实 HEAD 恢复，不重复文档迁移或已完成任务。

## 可直接提供给 Devin 的启动输入

> 在本仓库读取 docs/wave1.5/README.md、status.md、devin-plugin.md 和 W15-XX 任务卡。执行本次明确授权的 W15-XX 当前合同子集；检查实际 HEAD/工作树/固定 API，保留已有改动。按正式 DS/HIG/Grid/Architecture 实现一个完整纵向切片、测试、review 和状态更新。未获授权的 API/Future 部分保持 gated；无需同级 Server checkout 或本地研究。交付真实 diff、验证及下一步，不自动扩大范围或发布。

首次正式 handoff 应把 W15-XX 替换为 W15-00（文档审查/发布），或在该基线已完成后替换为获授权的 W15-01，并给出实际文档 commit 与当前验证环境。

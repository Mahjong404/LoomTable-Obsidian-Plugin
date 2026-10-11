# LoomTable Wave 1.5 — 实施入口

2026-10-12。**Wave 1.5 Design Phase Complete — Ready for Implementation Handoff。** 当前权威视觉、布局、组件与交互设计已获用户批准；Wave 1 继续 Approved/Frozen。文档整理已授权，产品实现尚未开始。执行某个开发切片时，以用户交给 Devin 的明确任务范围和下列 Gate 条件为准。

## 从这里开始

| 阅读目的                                          | 正式入口                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 总体范围、阶段、依赖与验收                        | [Master Implementation Plan](implementation-plan.md)                                                                  |
| 设计要求、Figma 权威、源码差异、任务和测试        | [Design-to-Code Traceability](traceability.md)                                                                        |
| 每个切片的完整任务合同                            | [Detailed Task Specifications](task-specifications.md)                                                                |
| 当前 API 事实、六条 Gate、Future 合同与跨仓库顺序 | [API Boundary](api-boundary.md)                                                                                       |
| 真正需要审批的合同及工程风险                      | [Risk Register](risk-register.md)                                                                                     |
| Plugin 独立执行入口                               | [Devin Plugin Execution Guide](devin-plugin.md)                                                                       |
| 唯一实施状态、审批及跨仓库交付引用                | [Status](status.md)                                                                                                   |
| Server 独立执行入口                               | [Server 仓库 docs/wave1.5/README.md](https://github.com/Mahjong404/LoomTable-Server/blob/main/docs/wave1.5/README.md) |

本目录承载实施范围、任务与进度。长期产品规范仍在 [UI 入口](../ui/README.md)；技术所有权见 [Field Editor Lifecycle](../architecture/field-editor-lifecycle.md)。任务卡中的行为是这些规范的验收应用，不另建一套 Design System。

## 范围与启动条件

- **Lane A：现有合同支持的 UI 收敛。** 对应 P1.6 的现有功能修复、编辑器替换、响应式、可访问性和技术债；按 13 个实施包组织。W15-00 是文档基线审查，W15-01–11 是纵向交付，W15-12 是集成验收。W15-08A 可以先修安全问题，W15-08B 必须等待 G5。
- **Lane B：合同驱动的新能力。** G1–G6 先逐条完成合同评审与授权，再 API-first 实施。它们不自动进入 P1.6。G6 可单独申请既有功能正确性修复的窄 API 例外。
- **Future：Time/DateTime、12h、整 Table 回滚。** 已批准视觉不解锁字段、存储、权限和兼容性合同。12h 保留近期 1–2 个主要版本不实施的门槛。Avatar/Profile/Cascader 和细粒度转换审计保持 Deferred。

DatePicker 和当前 ID Choice、Query Panels、Grid、View/Rename 等不需要等待未来 Time API。Header 全查询选择、Atomic Choice、新三色写入、View order 和最终 Record 操作投影分别等待对应 Gate。

## 文档维护与发布

正式行为分别只维护在 Design System（视觉）、HIG（交互）、Grid Spec（Grid 专属）、Architecture（所有权与数据流）。API 候选与启用门槛只维护在本目录 API Boundary；实际 wire 合同仍由 Server OpenAPI 和 Plugin 固定快照定义。阶段 README、AGENTS 和 Skills 只路由，不复制进度。

本地研究、竞品资料、原始审计、截图、临时产物与废弃方案不属于这套正式文档，也不作为执行依赖。原件继续留在忽略目录；无需强制加入 Git。实施中只更新实际改变的规范和本目录状态，不重写 P1.5/P1.6 历史。

当前文档已在两个工作树中准备，尚未提交或推送。独立 GitHub 环境启动前，应先按仓库工作流审查并提交这批文档，在 handoff 中指定包含它们的 commit。无需再次迁移本地规划，也不依赖当前聊天上下文。

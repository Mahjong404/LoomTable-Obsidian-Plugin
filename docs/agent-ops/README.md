# Agent 工程操作入口

新接手的 DSH、Codex 或其他实现 Agent，先读仓库根 [AGENTS](../../AGENTS.md)，再按本入口恢复。这里定义操作流程；产品行为、设计与状态仍由原正式文档拥有，不建立第二套规范或状态表。

| 工作                                               | 必读                                      |
| -------------------------------------------------- | ----------------------------------------- |
| 分支、身份、Issue/PR、Review、合并、发布、CI、清理 | [Git 工作流](git-workflow.md)             |
| 任意任务、DSH 接手、测试与 Git 交付                | [Plugin SOP](plugin-sop.md)               |
| Figma 节点、Variants、Token、设计修改              | [Figwright SOP](figwright-sop.md)         |
| 可见 Obsidian / CDP / 安装 Bundle / 语言           | [Obsidian CDP SOP](obsidian-cdp-sop.md)   |
| UI 验收、Golden、Review 与用户视觉批准             | [UI Acceptance SOP](ui-acceptance-sop.md) |

工具可用性必须在当前 Session 重新检查。DSH 不被假定已安装任何 plugin、Skill、浏览器驱动或 CDP helper；工具名称可参考本 SOP 已验证接口，执行参数以当前工具 schema 为准。离线或缺少权限时报告证据和 Not Verified，不自行安装替代工具、切换模型或伪造验收。

单一事实入口：[阶段范围](../p1.6/README.md)、[Wave 状态](../wave1.5/status.md)、[任务合同](../wave1.5/task-specifications.md)、[API 边界](../wave1.5/api-boundary.md)、[UI 规范](../ui/README.md)、[生产组件 API](../ui/loom-ui.md)。本入口不解锁 Future / Deferred，也不授予其他 Session 文件修改权。

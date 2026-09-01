# LoomTable Interaction HIG 落地计划

> 本文档是实施计划，不是规范性 HIG。规范要求见 [Interaction HIG](./interaction-hig.md)。

## 目标

将 Interaction HIG 逐步应用到 LoomTable Plugin 的现有 UI 和后续 View，同时保持当前 Server/Plugin 契约稳定，避免把一次性全量 UI 重写混入功能开发。

## 落地原则

- 新增组件和新 View 直接遵守 HIG；
- 现有界面按关键路径逐步迁移；
- 迁移优先覆盖 Grid、Map、Record Detail、Save Status 和 Conflict UI；
- 不因为视觉迁移修改已经发布的 Server 字段或 Mutation 语义；
- 不把 HIG 的规范要求改写成阶段性可选项；
- 阶段只表示实施顺序，不表示该规范可以暂时忽略。

## 实施顺序

### 当前 P1 收口

范围：

- Location Editor 与 Map A2；
- Grid/Mutation/Conflict/Offline 状态闭环；
- Grid、Map、Record Detail 关键路径使用统一保存状态；
- WPS 风格的 View 级 Save Status；
- Location 有效坐标的“在 Map 中打开”和 Ctrl/Cmd 悬停预览；
- 真实 Server/Obsidian 跨仓 smoke。

不在当前 P1 加入：

- Relation、Formula、Lookup、Rollup 等新字段；
- 完整 Table Shell 和 View Tabs；
- Dashboard 组件；
- 全量旧 UI 重写。

### P1.5 设计与迁移

范围：

- Field Capability Matrix；
- 统一 Field Renderer/Editor；
- Table Shell、View Tabs 和 View 创建建议；
- Grid 的 Hide/Filter/Sort/Width/Order/Frozen/Row Height；
- Record Detail 复用；
- Component Gallery；
- `--loom-*` Token 接入真实 Primitive；
- Note Link、Email/Phone Preset、Import/创建向导等后续设计。

### P2 字段与 View 扩展

范围：

- DateTime、Rating、Relation、Formula、Lookup、Rollup；
- Created Time、Last Modified Time、Auto Number 等 System Field；
- Kanban、Gallery、Calendar、Form 等满足前置条件的 View；
- 新 View 必须直接遵守 HIG，并复用 Field Renderer、Record Detail、Toolbar 和状态组件。

### Dashboard 专题

Dashboard 不在 HIG 落地阶段内提前展开完整设计。HIG 正式完成后，单独启动 Dashboard 设计专题，重点处理：

- Dashboard 与普通 View 的关系；
- 统计卡、饼图、柱状图、折线图、地图、甘特图的字段前置条件；
- Server 聚合、组件级 Filter 和数据一致性；
- 固定网格布局、行轨道、组件尺寸、响应式重排；
- 组件级 Loading、Empty、Error、Configuration Required；
- 图表结果回到网格数据的可追溯性。

## 迁移策略

- 新组件不得复制旧 UI 的硬编码颜色、全局 CSS 或未定义状态；
- 修改旧组件时，优先迁移其命名空间、Token、焦点、状态和文案；
- 已有界面可以暂时处于待迁移状态，但不得作为新实现的参考；
- 迁移一个 View 时，应同时检查其 Light/Dark、窄容器、键盘、触控、错误和离线状态；
- 视觉调整不得改变 Field 值、Mutation、Revision 或 View 所有权语义。

## 阶段完成门禁

每个阶段的 UI 工作至少需要：

- 相关 Component Gallery 状态通过；
- 类型检查、测试和生产构建通过；
- 关键路径完成 Obsidian Workspace View smoke；
- 真实跨仓依赖使用已发布的 Server/OpenAPI 合同；
- 没有未说明的 HIG 例外；
- 相关实现任务和统筹 session 已同步当前阶段、阻塞点和下一目标。

## 当前未授权范围

本计划不自动授权：

- 修改 Server API 或数据库合同；
- 将 Dashboard、Relation 或计算字段提前加入当前 P1；
- 一次性替换所有现有 CSS；
- 引入新的 UI 框架；
- 自动创建条件 View；
- 将 Obsidian Bases 或外部平台同步当作核心数据事实来源。


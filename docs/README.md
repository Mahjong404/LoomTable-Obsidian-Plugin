# LoomTable Obsidian Plugin 文档

`docs/` 按职责分层。每类问题的 canonical source 如下；同一条规则只在一处维护，其他文档只做指针，不复制规则文本。

## 分层职责

| 目录 | 职责 | canonical 内容 |
|---|---|---|
| `product/` | 产品需求、范围与路线 | 产品边界、阶段设想、部署形态 |
| `design/` | 产品/系统设计 | Plugin 职责、运行边界、用户流程、质量目标 |
| `ui/` | UI/UX canonical 规范 | HIG、Design System、Grid/Map 特性规范（入口与层级见 [ui/README.md](./ui/README.md)） |
| `architecture/` | 技术架构与工程决策 | Client 接口合同、源码/仓库结构、技术详细设计、ADR |
| `p1.5/` | P1.5 阶段实现规范与记录（**已交付**） | View/Grid、Map/Location、Record 生命周期的实现级行为合同 |
| `releases/` | 版本与发布记录 | 各版本基线与范围 |
| `local/` | 本地研究/审计/探索材料（gitignored） | 不是正式规范，不入库 |

规范冲突裁决顺序见 [ui/README.md](./ui/README.md#规范冲突的裁决顺序)；产品/合同事实的权威次序见 [p1.5/README.md](./p1.5/README.md)。

## 产品与系统设计

- [产品范围](./product/scope.md) — 产品定位、字段/View 阶段规划、部署形态
- [Plugin 概要设计](./design/overview.md) — Plugin 职责、运行边界、P0 用户流程、质量目标

## UI/UX 规范

- [UI 文档入口（职责划分与规范层级）](./ui/README.md)
- [LoomTable Interaction HIG](./ui/interaction-hig.md)
- [UI Design System](./ui/design-system.md)
- [Grid View 规范](./ui/grid-spec.md)
- [Map View 与瓦片提供方规范](./ui/map-spec.md)

## 架构与工程决策

- [Plugin Client Interface](./architecture/client-contract.md)
- [Plugin 详细设计](./architecture/detailed-design.md)
- [Plugin 源码结构](./architecture/source-layout.md)
- [Plugin 仓库结构与文件职责](./architecture/repository-layout.md)
- [Attachment resource lifecycle decision](./architecture/attachment-resource-lifecycle-decision.md)

## P1.5 实现规范与阶段记录（已交付）

- [范围与需求定义](./p1.5/README.md) — 阶段属性与需求 ID
- [View 与 Grid 实现规范](./p1.5/view-grid.md)
- [Map 与 Location 实现规范](./p1.5/map-location.md)
- [Record 生命周期实现规范](./p1.5/record-lifecycle.md)
- [Devin SWE2 工作流与启动指令](./p1.5/workflow.md)
- [进度状态表](./p1.5/status.md)

## 发布与历史

- [v0.1.1 发布说明](./releases/v0.1.1.md)
- [开发日志](./development-log.md) — 实现里程碑历史记录，不是当前规范

## 本地材料

`docs/local/`（gitignored）存放 UX 审计、外部产品研究与探索稿；`docs/ui/visual-style-comparison.md` 同属 gitignored 本地材料。它们仅供内部参考，不作为正式规范依据，正式规范不引用其中内容。

Plugin 使用的领域术语、字段语义和 API 合同以 LoomTable Server 仓库中的对应文档为准。

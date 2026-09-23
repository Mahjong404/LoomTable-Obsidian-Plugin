# P1.5 实现要求

> **阶段属性**：P1.5 需求已全量交付（明细见 [状态表](./status.md)）。本目录保留为该阶段的范围定义与记录：`view-grid.md`、`map-location.md`、`record-lifecycle.md` 仍是相应已实现行为的有效实现合同；本文与 [workflow.md](./workflow.md) 保留为阶段范围记录与后续阶段的工作流参考。后续阶段若沿用本工作流，应新建对应阶段目录，不在本目录继续追加范围。

本文是 Devin SWE2 开发 P1.5 的唯一范围入口。目标是在现有客户端上完成可持续使用的 Grid、View 管理、Map/Location 和单条 Record 生命周期。按 [开发工作流](./workflow.md) 执行，进度只写入 [状态表](./status.md)。本文描述目标行为，不表示这些功能已经交付。

## 范围与完成定义

本次将旧 S1–S6 中的客户端基础和剩余实现统一为 P1.5，不再使用“P1.5 已完成、S4/S5/S6 又未完成”的双重口径。旧 S0 桌面证据收尾不再是一项开发工作。

取消所有 smoke 要求：不执行、不补证、不维护 PASS/UNVERIFIED 矩阵，不以 Obsidian 安装、真实窗口、截图、真实 Server、公共瓦片或私有 Token 作为开发、合并或阶段完成门禁。也不改名为“人工联调/桌面验收”继续要求同一流程。自动化功能测试、合同测试、类型检查和构建仍须完成；取消门禁不代表曾经未执行的检查已经通过。

P1.5 完成需要下表全部需求有生产接线、对应自动化行为测试、通过仓库检查，且没有未处理的范围内缺陷。接口占位、静态 UI、仅有 fake 实现均不算完成。

| 需求 ID | 交付内容 | 实现规范 |
| --- | --- | --- |
| F1 | 十类字段统一展示/编辑，维持空值、权限、附件来源和保存语义 | 本文“已有基础”与“字段能力” |
| V1 | 稳定 Table Shell，Grid/Map 共用 View Tabs 与导航 | [View 与 Grid](./view-grid.md) |
| V2 | View 新建、复制、重命名、软删除、回收列表、恢复、配置修复 | [View 与 Grid](./view-grid.md) |
| V3 | 嵌套 Filter、多字段 Sort、临时 Search、服务端查询和分页一致性 | [View 与 Grid](./view-grid.md) |
| V4 | Hide/Show、Order、Width、Frozen、Row Height 的实际可用控制 | [View 与 Grid](./view-grid.md) |
| V5 | Grid 键盘、单 Cell 剪贴板、虚拟化、稳定焦点及详情联动 | [View 与 Grid](./view-grid.md) |
| M1 | Location 真正的临时单点地图预览及条件化打开 Map | [Map 与 Location](./map-location.md) |
| M2 | Cluster Record 列表与共享 Detail、配置修复、数据/瓦片独立状态 | [Map 与 Location](./map-location.md) |
| R1 | 新增单条 Record，安全处理重复提交及未知结果 | [Record 生命周期](./record-lifecycle.md) |
| R2 | 单条 Record 软删除、回收站、恢复及撤销删除 | [Record 生命周期](./record-lifecycle.md) |
| R3 | 生命周期与现有队列、持久化、Conflict、Change 失效协同 | [Record 生命周期](./record-lifecycle.md) |
| Q1 | 新旧界面共用文案、保存状态、焦点、主题与窄布局规则 | 本文“工程规范” |
| Q2 | 可运行的开发组件 Gallery 与自动化状态覆盖 | [开发工作流](./workflow.md) |

## 本地阅读基线

2026-09-14 读取的 Plugin HEAD 为当时 main 基线（版本 `0.1.3`；提交 SHA 属历史重写前历史，不作为当前引用）；Server HEAD 为 `ab949d59c37680d53b4109e1502f8478b24cc655`。这些是本地事实，不冒充本次远端核验。

Plugin 的固定合同来源由 [source.json](../../openapi/source.json) 记录，目前为 `ef0c6bd751642f4a604fe1bf88980f64e39dd992`。本次检查两个 OpenAPI 文件内容一致；新功能仅补足该合同的客户端消费。不得为完成 P1.5 修改 Server 源码、数据库、部署、OpenAPI 快照或手工编辑生成类型。

权威次序：用户当前要求 → 本目录的 P1.5 范围/产品选择 → 已发布 OpenAPI 的传输事实 → [Interaction HIG](../ui/interaction-hig.md) 的通用交互 → 现有代码与测试。实现规范不能改变 API 事实；若发现矛盾，报告具体请求/响应或本地合同位置，继续不受影响的工作，不猜接口。

产品术语参考同级 Server 的 `CONTEXT.md`，字段数据规范参考 Server 仓库 `docs/field-types.md`（本仓库无此文件）。只有 Plugin 仓库的 Devin 环境可直接使用固定快照、本文字段矩阵和现有测试，无需额外运行 Server。

## 已有基础：复用并验证

以下内容在本地基线中已经有生产实现。先读相关代码和测试，只有可复现缺口才修改；不重新做一遍 S1–S3。

| 能力 | 代码入口 | P1.5 的处理 |
| --- | --- | --- |
| 字段共享语义 | `src/ui/field-renderer-registry.ts`、`field-value-editor.ts` | 扩展查询能力元数据，保持既有 renderer/editor |
| Grid/Detail 编辑与草稿 | `grid-view-controller.ts`、`readonly-grid-renderer.ts`、`record-detail.ts` | 与 Shell/生命周期接线，保留失败草稿和完整 Record 回写 |
| 持久化队列与重试 | `mutation-queue.ts`、`mutation-queue-scheduler.ts`、`mutation-queue-runtime.ts`、`src/settings/mutation-queue-settings.ts` | 已支持 UpdateRecord；生命周期要扩展真实 runtime/store，不能只扩大类型 |
| Attachment 动作 | `attachment-upload.ts`、`attachment-host.ts`、`attachment-download.ts` 与 Detail | 已有 Add/Upload/Download/Open/Preview/Detach/Retry；只做回归和生命周期协同 |
| Map 数据与 Cluster | `src/views/map/`、`src/maps/renderer/` | 已有服务器聚类分页、可访问列表、共享 renderer；完善标题/导航，不重写聚类 |
| Settings 与凭据 | `src/settings/`、`src/credentials/` | 复用持久化回滚、连接检查、SecretStorage；不是新的功能项目 |

已证实的剩余点：`LoomTableClient` 缺少 get/create/delete/restore View；当前 View 导航使用 Select；无 Filter/Sort 配置 UI；列宽/行高已有渲染，冻结列及配置操作需补齐；Location `createPreviewTrigger` 只追加坐标 span；队列持久化请求仍限定 `[UpdateRecordCommand]`；没有 Record 生命周期 UI。

## 字段能力与值规范（F1）

| 类型 | 展示/编辑要求 | Filter operator | Sort |
| --- | --- | --- | --- |
| Text / LongText / URL | 共用 renderer；LongText 多行；URL 值只允许绝对 http/https | is、isNot、contains、notContains、startsWith、endsWith、isEmpty、isNotEmpty | 支持 |
| Number / Date | 有限数字；有效公历 YYYY-MM-DD，不隐式转 DateTime | is、isNot、greaterThan、greaterOrEqual、lessThan、lessOrEqual、isEmpty、isNotEmpty | 支持 |
| Checkbox | 原生 checkbox 与文字语义，不只显示色块 | is、isNot，值为 boolean | 支持 |
| Select | 显示 option name，保留已引用 deleted option 的状态 | is、isNot、isEmpty、isNotEmpty | 支持 |
| MultiSelect | Chip 和可访问多选；紧凑区域截断为前几项 +N，Detail 可看全部 | includes、excludes、isEmpty、isNotEmpty | 不支持 |
| Location | label/address、坐标及 located/unlocated/unrenderable 状态；专用 Detail 编辑 | isEmpty、isNotEmpty | 不支持 |
| Attachment | Grid/Cluster 紧凑摘要，Detail 结构化元数据和已支持动作 | isEmpty、isNotEmpty | 不支持 |

Filter 值规范与编辑值规范并不完全相同，具体见 V3。类型能力应放在已有 registry 或邻近纯模块中，不在各菜单重复硬编码。

- 缺少键是 Unset；显式 `null` 是 Cleared；`""`、`[]` 是对应类型的自然空值；禁止靠 truthiness 将 `0`、`false`、空值混为一类。
- `set` 写入值；`unsetFieldIds` 移除键；同一字段不能同时出现。未知或已删除字段只读，不降级为 Text 并写回。
- 新 Record 不得引用 deleted option；已有 Record 可以原样保留已有的 deleted option，不能借编辑新增它。未知 option 显示不可用，不能静默替换。
- Detail 总是按字段定义顺序显示；Grid projection 缺少某键不证明该字段 Unset。在线按 ID 获取完整 Record 后编辑；离线缺失内容标为未缓存，不伪造空值。
- Attachment Detach 仅移除当前字段的一个引用，最后一个引用使用 `set: []`，不删除资源或 Vault 文件。Managed 上传 ready 后才关联；文件上传与 Record 保存分别反馈。
- Managed 下载/预览走 content GET；Vault 下载只读安全相对路径对应的 TFile，可沿用现有离线本地下载。其他写入仍离线禁用。复用既有路径检查、object URL 回收和受限 Retry。

## 工程规范（Q1）

- TypeScript strict + 原生 DOM + 现有 Obsidian API/Leaflet；沿用项目格式与目录，不引入 UI 框架或为了本阶段全面迁移源码目录。
- UI → controller/domain → `LoomTableClient` → HTTP adapter。生成类型只在 adapter 边界使用；组件不拼 API URL，不直接调用 fetch/requestUrl。
- 每个异步动作有明确 owner、身份、pending、成功/失败和销毁处理。读取迟到时丢弃；已发送写入继续由 owner 记录结果，不能因 UI 消失而丢失未知结果。
- 相同对象的写入串行；有界重试由既有传输/调度层负责，新增 UI 不叠加重试循环。内部 queued 不暴露为独立用户状态。
- 普通文案使用 en/zh-CN 类型安全消息；字段名等用户文本用安全 DOM API。诊断只显式展开 code/status/requestId，不打印凭据、完整 Record、附件 bytes 或展开的瓦片 URL。
- 复用危险确认；取消零写入；重复点击只产生一个逻辑动作。草稿关闭和导航经 dirty guard；已入队的保存可跨导航继续。
- `.loom-*` 命名空间及 `--loom-*` token；支持 Light/Dark fallback、reduced motion。控件用原生语义、可访问名称、可见 focus ring、输入错误关联及状态文字。
- 宽/窄按容器尺寸适配。窄布局保留 View 切换、筛选、排序、详情和恢复入口，工具栏可换行/折叠，Grid 在自身区域横向滚动，浮层不能超出容器。

## 明确排除

P1.5 不交付：Server 新能力；Workspace/Base/Table/Field/Option 管理 UI；Attachment 资源 Delete/Restore/GC；批量 Record 生命周期；逐字段冲突合并；离线新写入；矩形粘贴；列虚拟化；拖拽列宽/列序；新字段类型/Email/Phone/Note Link；导入导出/创建向导；新 View 类型/Group/Dashboard；地理编码或 Provider 扩展。

宽度数值设置、冻结列、嵌套 Filter、单条 Record 生命周期属于本期必做，不能因为排除了拖拽和批量功能而省略。通用 HIG 中的后续产品示例不自动增加本期范围。

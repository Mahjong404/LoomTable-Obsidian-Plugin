# LoomTable Obsidian Plugin 开发日志

本文保留实现里程碑，当前任务与进度只见 [P1.5 要求](./p1.5/README.md) 和 [状态表](./p1.5/status.md)。下列 PR 是原日志记录的历史线索，本次没有重新查询远端 CI，不将历史记录作为当前实现已完成的证据。

## 2026-09-14：P1.5 统筹交接

- 合并重复计划，形成 View/Grid、Map/Location、Record 生命周期的实现规范、工作流和需求状态表。
- 取消 smoke、安装用户插件包、真实窗口/公共瓦片与截图证据门禁；移除旧审计矩阵和重复残余要求。
- 新功能尚待 Devin SWE2 实施，本次没有业务代码、合同或版本变更。
- 本地阅读 HEAD 为 `c893cdbb1dc3e56a94f82990b26ca9cc8bf75263`；固定 API source 仍由 `openapi/source.json` 记录。

## 已有实现摘要

| 能力 | 原日志记录的代码交付 | 现有行为 |
| --- | --- | --- |
| 工程与只读 Grid | PR #2/#6/#7 | HTTP Client、固定 API、资源导航、Grid 基础 |
| Location/Map | PR #29 | Location 编辑及 Map 生命周期 |
| 队列持久化/调度/runtime | PR #34/#45/#47 | UpdateRecord 持久化、同 Record 串行、不同 Record 并行 |
| HIG/主题/Conflict/失效 | PR #38/#43/#51/#52 | CSS token、冲突恢复、Map/Location invalidation |
| 文案与异步保护 | PR #54/#56/#57/#58 | 中英文状态、校验、确认、IME、Map fitAll/Cluster 迟到响应保护 |
| S1 共享交互 | PR #68/#70/#72/#74 | 控件几何、Settings 诊断确认、Map 操作防重、Grid/Detail 焦点与草稿 |
| S2 现有流程 | PR #77/#79/#81/#83 | 失败草稿、Location 状态、Cluster 列表与错误、Settings 保存回滚 |
| S3 字段共享 | PR #86/#88/#90 | Registry、Select/MultiSelect、结构化 Attachment |
| S3 Attachment | PR #92/#94/#96/#98/#100 | 下载、宿主接线、上传后关联、Preview/Open、Detach 和受限 Retry |
| S3 下载来源分流 | 原日志 S3-C3-C4 | Managed content GET；Vault 安全路径本地下载 |
| S3 Date/Detail | PR #105/#107/#108 | Date 校验一致、标量/URL/Select/MultiSelect 详情编辑 |
| 固定快照漂移修正 | 本地 HEAD `c893cdb` | sync 脚本不额外追加换行，快照与 Server 对齐 |

历史最后的业务实现点记录为 `c40c8f6d812ba04752c4f67bb0ba621862a3e253`（PR #108）。上述实现仍以现有源码和测试为准；不因重新整理文档重做已经完成的基础。

## 当前稳定边界

Server 是事实来源；普通离线状态只读。Mutation 的 request/key/revision、完整返回 Record、Conflict 和 Change 语义保持。Attachment Detach 不是资源 Delete；资源 Delete/Restore/GC 不属于 P1.5，边界见 [附件决策](./design/attachment-resource-lifecycle-decision.md)。

## 后续记录方式

每个完成的代码切片增加简短条目：需求 ID、用户行为、主要代码位置、实际检查结果和交付状态。细粒度进度只在状态表记录，不再复制 main SHA/CI/桌面矩阵形成多份互相冲突的当前状态。

## P1.5 切片 A（V1/V2 基础）

- 行为：`LoomTableClient` 新增 `getView`/`createView`/`updateView`/`deleteView`/`restoreView` 与 `normalizeResourceName`；Grid/Map 共用 `TableShell`（Workspace/Base/Table Select、`role="tablist"` View Tabs、Add View 表单、未确认创建提示）；显式创建 Grid/Map View（Map 要求 active Location Field）；View 写入经 `ViewWriteCoordinator` 按 View 串行化，未决创建按 `intentId` 持久化。
- 代码：`src/client/loomtable-client.ts`、`http-loomtable-client.ts`、`src/ui/table-shell.ts`、`view-write-coordinator.ts`、`src/settings/view-intents.ts`、`grid-view-controller.ts`、`readonly-grid-renderer.ts`、`views/map/map-view.ts`、`loomtable-view.ts`。
- 测试：`tests/client/view-management.test.ts`（10）、`tests/ui/table-shell.test.ts`（8）、`tests/ui/view-write-coordinator.test.ts`（12）、`tests/settings/view-intents.test.ts`（5）、`grid-view-controller.test.ts` View 创建/回退（6）、renderer/map 接线回归。
- 检查：`pnpm check` 全绿（format/lint 0 error/typecheck/471 tests/api diff/build）；`git diff --check` 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 A 完成；View 重命名/复制/删除/回收/恢复与配置修复属切片 B。

## P1.5 切片 B（V2 剩余：View 管理）

- 行为：`TableShell` 新增 Manage Views 面板（活动列表 + `lifecycle=deleted` 回收列表，零活动视图可达）；重命名 PATCH 完整 config+expectedRevision；复制确认新名称、仅拷 type/config，query 语义失效引用先要求修复、不静默丢 Filter，presentation 过期引用复制时清理；软删除命名确认、已删幂等、选中回退 next→previous→空态；恢复按最新 deleted revision；配置修复展示 `brokenFieldIds`、显式移除 query 引用、Map Location Field 必选重选；冲突/未决/失败以 issue 行呈现 adopt-latest/re-edit/retry/dismiss；Map camera 保存与全部 View 写统一经 `ViewWriteCoordinator`；Map 导航实时刷新，当前 Map 被删自动回退。
- 代码：`src/ui/table-shell.ts`、`view-write-coordinator.ts`、`view-config-repair.ts`、`grid-view-controller.ts`、`readonly-grid-renderer.ts`、`views/map/{map-view,map-view-controller}.ts`、`loomtable-view.ts`、i18n、styles.css。
- 测试：`table-shell.test.ts`（17）、`view-write-coordinator.test.ts`（19）、`view-config-repair.test.ts`（8）、`grid-view-controller.test.ts`（50）、`map-view.test.ts`（27）。
- 检查：`pnpm check` 全绿（format/lint 0 error/typecheck/509 tests/api diff/build）；`git diff --check` 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 B 完成；V3 查询/筛选/排序/搜索/分页失效属切片 C。

## P1.5 切片 C（V3：Filter/Sort/Search/分页失效）

- 行为：`view-query-model` 提供类型化 operator 选择、嵌套 and/or 组树操作、草稿校验（空组/深度 8/节点 100/未知字段/不支持 operator/缺失或类型不符值/未知选项）与合同预算（Sort 10、Search 500 码点）；Filter Builder 空草稿起步、按 Field 类型渲染值编辑器、嵌套组/删除/已删选项标注/脏草稿丢弃确认/应用失败保持打开；Sort Panel 仅可排序字段、去重、上限、方向/nulls/重排/删除、空列表清除；Search 仅显式提交、trim 归一化、超长拒绝且保留草稿、不落 View 配置；表头单一排序循环 asc→desc→清除、多排序打开面板；查询语义变化重置分页并重查第一页；requestToken 丢弃过期响应、cursor-expired 自动回第一页、续页按 Record ID 去重；Filter/Sort 写经 `ViewWriteCoordinator`（serialized、issue/retry 复用、controller 侧草稿防御校验）；面板在父级整树重绘后经 `onInvalidate` 重建；no-match 空态提供清除 Filter/Search 与重开编辑器动作。
- 代码：`src/ui/view-query-model.ts`、`filter-builder.ts`、`sort-panel.ts`、`query-focus.ts`、`grid-view-controller.ts`、`readonly-grid-renderer.ts`、`loomtable-view.ts`、i18n、styles.css。
- 测试：`view-query-model.test.ts`（22）、`filter-builder.test.ts`（9）、`sort-panel.test.ts`（5）、`grid-view-controller.test.ts`（66，含 stale 续页丢弃/cursor-expired/写入后重查/校验拒绝）、`readonly-grid-renderer.test.ts`（40）。
- 检查：`pnpm check` 全绿（format/lint 0 error/typecheck/569 tests/api diff/build）；`git diff --check` 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 C 完成；V4/V5 显示控制与键盘/剪贴板/焦点属切片 D。

## P1.5 切片 D（V4/V5：显示控制与键盘/剪贴板/焦点/Detail 导航）

- 行为：Display 面板提供投影显隐（至少一列、主字段可隐藏、行级 Detail 不受影响）、上下移排序、宽度输入（80–1000、非法显式报错、重置删键回落 180px）、仅可见列冻结且冻结区靠左按 columnOrder 排列、三档行高；renderer 经 `resolveGridColumns` 消费配置（空 legacy projection 展开全部 active 列、隐藏列残留在 columnOrder 不渲染、表头 sticky、冻结列 left 偏移与表头/行一致、行高变更恢复首可见行+偏移锚点、窄布局禁用 sticky 并说明）；可打印字符替换式编辑、Ctrl/Cmd+C/V 经 `clipboard` host seam（Select 名称往返、结构型拒绝并提示、粘贴按类型校验走既有编辑队列）、Delete/Backspace 写 null、Detail scalar Unset 为独立确认动作（`unsetFieldIds`）；焦点含 Table/View/Record/Field，隐藏/移出按位次夹取回退，表头排序焦点按 fieldId 恢复，虚拟滚动保留编辑器行且不丢草稿不误提交；Detail 标题取 primaryFieldId、prev/next 沿查询序列且边界加载下一页、未知前页禁用 Previous、导航沿用草稿确认。
- 代码：`src/ui/grid-display.ts`、`display-panel.ts`、`grid-clipboard.ts`、`grid-view-controller.ts`、`readonly-grid-renderer.ts`、`record-detail.ts`、`loomtable-view.ts`、`views/map/map-view.ts`、i18n、styles.css。
- 测试：`grid-display.test.ts`（10）、`display-panel.test.ts`（8）、`grid-clipboard.test.ts`（7）、`grid-view-controller.test.ts`（71，含导航边界/翻页）、`readonly-grid-renderer.test.ts`（54，含 20k 行 DOM 上限/编辑器保留/焦点回退）、`record-detail.test.ts`（28）、`record-detail-field-edit.test.ts`（11，含 Unset 确认）。
- 检查：`pnpm check` 全绿（format/lint 0 error/typecheck/618 tests/api diff/build）；`git diff --check` 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 D 完成；M1/M2 地图预览与生命周期协同属切片 E。

## P1.5 切片 E（M1/M2：临时地图预览与 Map 生命周期协同）

- 行为：Record/Map Detail 的 Location 预览替换坐标 span 为真实 Map renderer（单 marker + 坐标摘要 + attribution）；按钮/键盘 Enter/Space/触摸立即打开、Ctrl/Cmd-hover 180ms 延迟打开，修饰键释放/指针离开/字段变更/Detail 关闭/窗口失焦/dispose 取消，trigger↔popover 150ms 容差；每次打开 generation 递增、迟到 provider/renderer 结果不落陈旧 DOM，renderer 每次预览 mount/destroy 恰好一次；初始 zoom 14 按 provider min/max 夹取、可见后 invalidateSize；provider 走既有解析链（匹配 Map View 用其 provider、否则 profile 默认），确认/配置/凭据缺失与离线零 tile 请求；预览不创建/保存 View、不调 Map query/summary/mutation/View-update API；Open in Map 按 0/1/N 匹配（同表 active Map + 同 locationFieldId）直达/选择器（预选当前）/进入创建表单预选 Location 字段，取消零创建、成功才导航；Map Detail 与 Cluster 标题统一 primaryFieldId，cluster 摘要为字段 chips 非原始 JSON；terminal cluster 用 recordsQueryToken 分页、过期清分页刷新视口不重试旧 token，cluster 失败不覆盖整体数据状态；Map 新增 Filter 面板复用 FilterBuilder，saved 后经 MapViewController.applyViewUpdate 失效 cluster 并重查（保 camera）。
- 代码：src/ui/location-preview.ts、src/ui/map-view-picker.ts、src/ui/record-detail.ts、src/ui/loomtable-view.ts、src/ui/table-shell.ts、src/ui/readonly-grid-renderer.ts、src/views/map/{map-view,map-view-controller,map-view-model}.ts、i18n、styles.css。
- 测试：tests/ui/location-preview.test.ts（19）、tests/ui/map-view-picker.test.ts（3）、tests/views/map-view.test.ts（33）、tests/views/map-view-controller.test.ts（46，含 applyViewUpdate/cluster 失效）、tests/views/map-view-controller-a1.test.ts（3）、tests/ui/table-shell.test.ts（17）、tests/ui/record-detail.test.ts（30）。
- 检查：pnpm check 全绿（format/lint 0 error/typecheck/60 文件 656 tests/api diff 为空/build）；git diff --check 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 E 完成；R1/R3 记录创建与队列集成属切片 F。

## P1.5 切片 F（R1/R3：单记录创建与持久化队列 V2）

- 行为：持久化队列升级 V2 schema（条目 kind + create 无 recordId/expectedRevision + operation 身份），V1→V2 确定性迁移保留请求/键/revision/retry/conflict，`sending` 恢复为 `queued`；Scheduler 按 lane 调度（同 Record FIFO、不同 Record/Create 并行），事件携带 operationId/kind/tableId，lane 移除时按被删条目回落元数据，新增 `getOperationSnapshot`/`retryOperation`/`discardOperation`；Runtime 恢复失败返回 null + `recoveryError`，`main.ts` 注入 `UnavailableMutationQueuePort`（新写入显式拒绝、不覆盖原存储）；`record-create-form` 复用字段编辑器/normalizer（Unset 语义、空表单可提交、附件提示后置、脏草稿确认、busy 防重复提交、校验失败保留草稿）；`createRecord` 生成稳定 `mut_` 键、先持久化后发送，`recordCreateOps` 跟踪 queued/sending/error/applied，跨 Table 事件过滤、dispose 后忽略迟到事件、`load()` 保留当前表在途 op、`gridSaveStatus` 聚合 create 状态；Grid/Map 工具栏「新增记录」与 ops 待处理表面（重试/放弃/打开新记录），成功后经 Detail 入口打开新 Record，applied 事件按返回 Record 真实 ID/tableId 走既有失效链。
- 代码：src/settings/mutation-queue-settings.ts、src/ui/mutation-queue-scheduler.ts、src/ui/mutation-queue-runtime.ts、src/main.ts、src/ui/record-create-form.ts、src/ui/grid-view-controller.ts、src/ui/readonly-grid-renderer.ts、src/views/map/map-view.ts、src/ui/loomtable-view.ts、i18n、styles.css。
- 测试：tests/settings/mutation-queue-settings.test.ts（10，含 V1 迁移/损坏保留）、tests/ui/mutation-queue-scheduler.test.ts（24，含 create lane 并行/discard/未知结果同键重发/冲突保留）、tests/ui/mutation-queue-runtime.test.ts（5，含恢复失败零新请求）、tests/ui/record-create-form.test.ts（11）、tests/ui/grid-view-controller.test.ts（75，含 create 跟踪/跨表过滤/dispose 保护）、tests/ui/readonly-grid-renderer.test.ts（57）、tests/views/map-view.test.ts（35）。
- 检查：pnpm check 全绿（format/lint 0 error/typecheck/61 文件 686 tests/api diff 为空/build）；git diff --check 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 F 完成；R2/R3 删除/恢复/生命周期门控属切片 G。

## P1.5 切片 G（R2/R3：记录删除/回收/恢复与生命周期门控）

- 行为：Grid 行、Grid Detail、Map Detail 共用一条 `deleteRecord` 生产路径（确认浮层 → 持久化队列 `deleteRecord` 命令，权威 `expectedRevision`）；删除成功前记录保持可见，applied 后移出活动页并出「记录已删除」通知（Undo 重发 restoreRecord、Dismiss 清除）；draft/pending（queued/saving/error/conflict）/offline/unavailable 门控先经 `canDeleteRecord` 判定并以既有 editError 横幅说明原因；Scheduler 在 delete 在途期间拒绝同 Record 的 update/delete 入队（restore 为唯一逆向通道），delete 在前序 update 应用后以最新 revision 重基不超车；delete/restore 冲突经 `conflictRetryEntry` 按原 kind 以 `currentRevision` 忠实重发，不转假 updateRecord；422 `INVALID_STATE_TRANSITION` 归类 terminal；终态失败后经 `discardAllForRecord` 清滞留 lane 头可重试；restore 先 `getRecord` 取最新权威 revision、已激活返回 already-active 不重发；回收站面板为独立 `lifecycle:'deleted'` 查询（不带 View/Filter），支持分页/loading/empty/error/restore，恢复或删除成功后已加载列表自动重查；恢复的 Record 不本地插入 filtered active 查询，经失效链刷新；跨 Table 事件过滤、destroy 后忽略迟到事件沿用既有保护。
- 代码：src/ui/mutation-queue-scheduler.ts、src/ui/grid-view-controller.ts、src/ui/readonly-grid-renderer.ts、src/ui/record-detail.ts、src/views/map/map-view.ts、src/ui/loomtable-view.ts、tests/fixtures/in-memory-loomtable-client.ts、src/i18n/{messages,zh-cn}.ts、styles.css。
- 测试：tests/ui/mutation-queue-scheduler.test.ts（26，含 delete 门控/重基/冲突按原 kind 重试）、tests/ui/grid-view-controller.test.ts（84，Record lifecycle 8 例）、tests/ui/readonly-grid-renderer.test.ts（63，Grid record lifecycle 6 例）、tests/ui/record-detail.test.ts（33，Detail 删除 3 例）、tests/views/map-view.test.ts（37，Map Detail 删除 2 例）。
- 检查：pnpm check 全绿（format/lint 0 error/typecheck/61 文件 707 tests/api diff 为空/build）；git diff --check 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 G 完成；Q2 Gallery 与全量覆盖属切片 H。
## P1.5 切片 H（Q2：开发 Gallery 与全量状态覆盖）

- 行为：开发专用 DOM Gallery 落位 `tests/gallery/`——`pnpm gallery` 经 esbuild 产出 `tests/gallery/bundle.js`（gitignored、iife、与 `src/main.ts` 完全独立），浏览器打开 `tests/gallery/index.html` 即用，侧栏列出九分区 14 场景；全部场景复用生产组件（`ReadonlyGridRenderer`/`TableShell`/`FilterBuilder`/`SortPanel`/`DisplayPanel`/`createRecordDetail`/`createRecordCreateForm`/`MapView`+`MapViewController`/`MutationQueueRuntime`+`MutationQueueScheduler`），数据走 `InMemoryLoomTableClient`，宿主能力经 typed fake（`GalleryMapRenderer` 可控 tile/point/cluster/camera/resize 事件）；interactive Grid 场景经真实 controller+持久化队列完成编辑/创建/删除/撤销/回收闭环（`onApplied→refresh` 接线与 main.ts 失效发布一致）；`InMemoryLoomTableClient` 补齐完整 `LoomTableClient`（`queryMap` zoom<10 输出 `cluster_inmemory`/`recordsQueryToken` 分页、`summarizeMap`、`pullChanges`、`getMeta`/`checkConnection`、附件方法以 capability 错误拒绝）；`gallery.test.ts` 25 项 jsdom 断言 DOM 语义/角色/可见状态，不做真实桌面像素验收；`eslint.config.mts`/`.gitignore` 排除 bundle。
- 代码：tests/gallery/{data,scenarios,main,index.html,README.md,gallery.test.ts}、scripts/build-gallery.mjs、package.json、.gitignore、eslint.config.mts、tests/fixtures/in-memory-loomtable-client.ts。
- 测试：tests/gallery/gallery.test.ts（25，含 registry 全场景非空挂载、确认浮层 cancel 解析、十字段列与状态行、deleted/unknown 选项、URL 安全链接、edit-state 标记、offline/no-match/回收站/无 View、interactive 真实删除与创建闭环、View 管理面板修复与冲突、三面板、不可用算子、Detail 导航、Map 特性/cluster/tile 错误/provider 缺失、宽度与 dark token 变体）。
- 检查：pnpm exec vitest run tests/gallery/gallery.test.ts（25/25）、pnpm gallery（bundle 构建成功）、pnpm check 全绿（format/lint 0 error/typecheck/62 文件 732 tests/api diff 为空/build）；git diff --check 干净；固定 OpenAPI 快照与生成类型未变。
- 状态：切片 H 完成；P1.5 需求表全部条目已交付。
## P1.5 后 UX 重排（导航/命令栏稳定分区 + Detail 右侧浮层）

- 行为：Grid 导航行与命令行重构为稳定分区——`.loom-table-shell` 三段 `context | tabs | actions`（actions 钉右，tabs 横向滚动不换行），`.loom-grid-toolbar` 两段 `start | end`（search+filter/sort/display 居左，count+save-status+create+recycle+refresh 钉右）；Grid 行序改为导航行在上、命令行在下，与 Map 一致；Map 工具栏同模型（start=filter+provider，end=save-status+fitAll+saveCamera+create+refresh）；`.loom-save-status` 固定 6.5em 宽 + 状态色点（saving 脉冲），消除状态文字宽度抖动；clipboard 通知移出 toolbar 独占状态行；Detail 从底部块改为 `.loom-detail-host`/`.loom-map-details` 右侧浮层面板（`position:absolute`、`min(26rem,88%)`、`--loom-panel-shadow` token、`:empty{display:none}`），覆盖 Grid 与 Map；duowei-table 实测样式与本仓 teable 惯例（钉右命令区、固定宽状态、右侧记录面板）为依据。
- 代码：src/ui/table-shell.ts（context/actions 分区）、src/ui/readonly-grid-renderer.ts（行序交换 + toolbar 分区 + `#renderClipboardNote`）、src/views/map/map-view.ts（工具栏分区 + save-status 入 end 组）、styles.css（分区规则、save-status 定宽与色点、detail 浮层、媒体查询）。
- 测试：tests/gallery/scenarios.ts 新增 Layout 三场景（annotated zones、save-status 六态、detail 浮层）、gallery.test.ts +3 断言分区结构与浮层挂载；tests/views/map-view.test.ts 按钮顺序更新。
- 检查：pnpm check 全绿（62 文件 736 tests、api diff 为空、build）；pnpm gallery 构建成功；git diff --check 干净。
- 状态：待用户在 Obsidian 实测确认分区与浮层体验。

## 2026-09-15 — UX 跟进：aria-label tooltip 修复 + 发丝线视觉

- 修复：Obsidian 全局 pointerover 委托会把任何 aria-label 渲染成 .tooltip 浮层——容器级 aria-label（.loom-view-tabs 的 '视图'、.loom-table-shell/toolbar 的 'Grid 状态'）悬停时弹出错位 chip（用户截图确认）。新增 src/ui/a11y.ts labelContainer()（隐藏 span + aria-labelledby），约 20 处容器（region/toolbar/tablist/form/dialog/grid）改为 labelledby；显示型 aria-label（单元格 td、chip/list/card、detail body、conflict pre、行 title）直接删除（可见文本自足，tooltip 是重复噪声）；save-status 保留 aria-label（折叠为 ✓ 后仍可访问），删除多余 title 避免双重 tooltip。
- 视觉（模仿 duowei-table/teable 无边框观感，细节见 docs/ui/visual-style-comparison.md）：.loom-root 新增 --loom-grid-line(55%)/--loom-grid-line-strong(90%)/--loom-header-bg/--loom-accent-soft/--loom-on-accent/--loom-accent-hover/--loom-selection-bg；单元格/行/列头/视口边框全部改用发丝线；视图页签改药丸式（激活=accent 12% 底+accent 字）；工具栏按钮 ghost 化（无边框透明底+hover 底），筛选/排序/显示按 aria-pressed/expanded 呈 accent 激活态；'新增记录'升为 accent 实底主按钮（Grid 与 Map 同）；行内 ↗/× 仅在行 hover/focus-within 显现；工具栏新增 1px 竖分隔线（搜索|查询开关、filter|provider）。
- 测试：受影响断言更新为新契约（labelledby 解析隐藏标签文本），styles-audit、gallery 全绿；pnpm check 全绿（62 文件 736 tests）。
- 文档：docs/ui/visual-style-comparison.md 新增——duowei/teable/LoomTable 六维度逐项对比（真实 CSS 值）+ D1–D8 决策点。

## 2026-09-15 — UX 跟进 2：列头类型图标 + 单元格选中态 + 基础右键菜单（D2/D4/D6）

- D2 列头字段类型图标：新增 src/ui/field-type-icon.ts —— 10 种字段类型到 Lucide 风格 stroke SVG 的映射（createElementNS 构建，无 innerHTML），`.loom-field-type-icon` 0.875rem/`--loom-text-faint`；可排序列图标置于排序按钮内、不可排序列置于 header cell 内，字段名与排序交互不变；排序指示器 margin-inline-start:auto 钉右。
- D4 duowei 式活动单元格：`.loom-grid-cell:focus/:focus-visible/:focus-within` 改为 `--loom-selection-bg` 底 + `inset 0 0 0 2px var(--loom-selection-border)` 内环（新增 token），z-index 3 覆盖冻结层；移除旧规则的 `position:relative`（会破坏 sticky 冻结列）；冻结聚焦单元格用不透明 `color-mix(accent 12%, bg-primary)` 防透底；`:focus-within` 保证内联编辑时环保持。
- D6 基础右键菜单：新增 src/ui/context-menu.ts —— DOM 菜单（role=menu/menuitem、危险项 data-variant、分隔线、Esc/外部 pointerdown/host scroll 关闭、ArrowUp/Down 循环、指针坐标定位+边界 clamp、host 内 absolute）；单元格菜单=编辑/复制（不可序列化禁用）/打开详情/删除记录（经既有 confirmDangerousAction，无 onDeleteRecord 时不出现），行号单元格菜单=打开详情/删除记录；i18n 三键 en+zh-CN。未用 Obsidian `Menu` API——renderer 保持无 obsidian 依赖的 jsdom 可测边界，视觉经 token 对齐原生。
- 测试：readonly-grid-renderer.test.ts +5（图标渲染与 aria-hidden、排序按钮带图标可点击、菜单项与 openDetails 闭环、Esc/外部点击关闭、删除走确认流）；styles-audit 焦点环断言更新为 --loom-selection-border。
- 检查：62 文件 741 tests 全绿；lint 0 error；format/typecheck 干净；api diff 为空；esbuild production build 通过；已部署至 vault 插件目录（main.js 549,948B / styles.css 45,044B）。
- 状态：待用户实测 D2/D4/D6 视觉与交互。

## 2026-XX — P1.5 UX 对齐切片（U1–U14，duowei/teable 参照）

- U1 列头右键菜单全量 + 新建字段：列头右键菜单（编辑字段/左右插入/隐藏/删除，主字段删除禁用，删除走确认）；末尾 `+` 表头格打开 `field-editor-panel`（10 种字段类型、select 选项+语义色）；client 新增 createField/updateField/deleteField/restoreField（Idempotency-Key、expectedRevision），InMemory fixture 同步实现。未改 Server——合同已含字段生命周期端点。
- U2 select 语义色 chip：option color token → `--loom-select-*` 调色板变量，单选也渲染 chip；删除选项保留可访问状态。
- U3/U12 选中模型：`#selection` 矩形选区（点击选中、Shift 扩选、行号整行、列头整列、Ctrl+A 全选、Ctrl+C 复制 TSV 经既有 clipboard host）；第二次点击进入编辑（duowei 模型）；选中态样式 + 底栏选中计数。
- U5 搜索命中高亮：gridState.search → `<mark>` 包裹匹配子串。
- U7 底部状态栏：行数 + 视图名 + 选中计数。
- U8 undo/redo：`src/ui/undo-history.ts` 本地命令栈（cell 编辑 before/after、新建→删除、删除→恢复、恢复→删除），controller `undo()/redo()` + GridState `canUndo/canRedo`，工具栏按钮 + Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y，`load()` 清空历史防陈旧 revision 重放。
- U9 列拖拽排序：表头 HTML5 DnD → 完整 display patch（columnOrder 重排）经 `onApplyDisplay`；行拖拽未做（Server 记录无 position）。
- U10/U6 Detail：modal 变体（`is-modal` 居中）+ 主字段置顶强调 + 空字段 `<details>` 折叠组。
- U11 附件缩略图：`attachmentThumbnail` resolver seam（vault 图片 → `app.vault.getResourcePath`）；Grid 紧凑格 ≤3 缩略图条，Detail 卡片缩略图；managed 附件保持文本态。
- U13 Tab/Shift+Tab 横向导航回绕。
- U14 窄屏回归：Detail ≤40rem 全宽、缩略图收敛、style audit 覆盖新选择器；tooltip 系统全面修复（容器 aria-label → aria-labelledby 隐藏标签，`ensureButtonLabels` 补齐按钮 tooltip）。
- 验证：63 文件 786 tests 全绿；lint 0 error；api diff 为空；已部署 vault（main.js 584,199B / styles.css 62,585B）。
- 待用户决定：U4 页签溢出策略（A 滚动+渐隐 / B +N 折叠菜单 / C 不动）。

## 2026-XX — UX 跟进 3：截图反馈修复 + U4 页签溢出（W1–W5 + U4-B）

- W1 加载横幅：已有记录时刷新不再渲染 `.loom-grid-status` 横幅；工具栏右侧 save-status 与「+新增记录」之间新增 `.loom-grid-loading-note`（role=status）提示刷新；空数据初始加载仍用完整状态块（含诊断/操作）。
- W2 表头统一：所有字段列头统一「类型图标 + 文本 + 排序指示」flex 骨架——可排序列结构进排序按钮、指示器 `margin-inline-start:auto` 钉右；不可排序列同一骨架，消除图标/文字/边框错位。
- W3 Detail 侧栏：location 操作并入 `.loom-location-actions` 单行紧凑按钮组（打开地图/复制/预览/编辑），unset/cleared/非法值也保留编辑入口；location 状态改 chip；侧栏内联按钮收敛为小尺寸。
- W4 新增记录行收窄：`.loom-grid-add-row` 列模板从整行 `columnTemplate` 改为 `56px auto`——「+」对齐行号列、文字紧随，不再呈现为整行宽按钮条。
- W5 查询面板浮层化：筛选/排序/显示/新建/回收站面板改为 `.loom-grid-toolbar` 内 absolute 浮层（top:100%+4px、width:max-content、min 24rem/max 40rem、max-height 70vh 滚动、panel shadow、z-index 50），不再以块级元素推移表格；焦点进入面板/取消恢复逻辑不变。
- U4-B 页签溢出：`#syncTabOverflow`（ResizeObserver 观察 tablist，超出宽度的页签置 `hidden`，选中页签强制可见）+ `.loom-view-tab-overflow`「+N」按钮（aria-haspopup=menu）→ `openContextMenu` 下拉列出隐藏视图（类型图标+名称），点击经 onViewChange 切换并关闭；箭头/Home/End 导航跳过隐藏页签；jsdom/未挂载时（clientWidth=0）不折叠。
- 测试：renderer +4（刷新指示/空态横幅保留/浮层锚定/新增行模板），table-shell +2（+3 折叠与菜单选中、选中页签强制可见）。
- 验证：63 文件 796 tests 全绿；lint 0 error；format/typecheck 干净；openapi 无 diff；esbuild 通过；已部署 vault（main.js 586,322B / styles.css 65,578B）；gallery bundle 已重建。

## 2026-XX — UX 跟进 4：刷新跳闪/表头框感/Detail 冻结/点击即编辑（X1–X6）

- X1 刷新跳闪根因：`.loom-grid-loading-note` 按 `status==="loading"` 反复插入/移除 toolbar 右侧组导致布局抖动。修复：加载指示改为常驻 slot，`visibility` 经 `data-active` 切换（有记录时不渲染 `.loom-grid-status` 横幅保持）。
- X2a 表头"Name 不一样"根因：`.loom-grid-sort` 是裸 `<button>`，吃到 Obsidian 全局 `button{box-shadow,border-radius}` 主题样式呈胶囊框；`#`/`Location` 无按钮故为平。修复：renderer CSS 内所有裸 button（`.loom-grid-sort`/`.loom-grid-open`/`.loom-grid-add-row`/`.loom-grid-add-field-button` 等）统一 `box-shadow:none` 重置。
- X2b 右侧死区竖条根因：`+` 新建字段列 track 只加在 header 模板（多 2.5rem），rows/canvas 不含 → header 右侧多出一截下方无元素无网格线的悬空区。修复：`+` 列并入统一列模板（header/rows/canvas 同宽），`+` 列下方随填充网格线自然延伸。
- X3 新增记录行：同为裸 button 无 box-shadow 重置导致"带框按钮"观感；重置后呈平文本行。
- X4a 页面冻结根因：modal 态 Detail 被 `.remove()` 后 `.loom-detail-host` 空壳留在 DOM；`.loom-detail-host:empty{display:none}` 与 `.is-modal{display:grid}` 同优先级且后者声明在后 → 空遮罩仍 `display:grid` 全屏拦截指针 = 整页冻结。修复：`onClose` 移除 host 前先清 `is-modal`；新增 `.loom-detail-host.is-modal:empty{display:none}` 兜底；modal 遮罩点击（target===host）即关闭。
- X4b 双 × 歧义：modal 态下 expand 按钮图标换成 `detail-close`（×）与真正关闭撞脸。修复：新增 `detail-collapse` 图标（向内箭头），modal 态用它。
- X5 点击即编辑：标量字段值容器挂 `.loom-record-field-editable`（role=button、tabindex=0、Enter/Space 激活），点击/键盘直接进编辑；独立「编辑字段」按钮移除；离线态不生成可编辑元素；checkbox 保留独立切换控件；location/attachment 维持专属操作。
- X6 审计文档：`docs/local/ux-audit-2026-09-15.md`（本地，不入库）。
- 测试：renderer +2（`+` 列模板三处一致/loading-note data-active），record-detail +2（唯一 close/modal 折叠图标），field-edit 测试改走 `.loom-record-field-editable`。
- 验证：63 文件 794 tests 全绿；lint 0 error；format/typecheck 干净；openapi 无 diff；已部署 vault（main.js 587,092B / styles.css 66,728B）；gallery bundle 已重建。

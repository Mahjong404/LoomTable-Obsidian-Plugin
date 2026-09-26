# P1.6 阶段：UI/UX 稳定化与打磨

P1.6 是 P1.5（功能交付）与 P2.0（新产品功能）之间的过渡稳定阶段。**本阶段不新增产品功能**；目标是把已有实现收敛到已建立的规范上，并清偿 UI 技术债。

## 阶段目标

- 现有实现与 [docs/ui/](../ui/README.md) 规范（Interaction HIG → Design System → 特性 spec）完全对齐；
- 修复已知 UI/UX 缺陷与观感问题；
- 收敛视觉与交互一致性，提升键盘/焦点/可访问性质量；
- 清理已登记的规范偏离与 UI 技术债。

## 允许的工作

- 修复现有 UI/UX 缺陷、状态/反馈/文案问题；
- 让实现与当前 HIG / Design System / 特性规范对齐；
- 响应式：容器宽度适配、窄面板布局、环境/交互能力适配（规则见 HIG §容器响应式）；
- 键盘、焦点管理、可访问性改进；
- 视觉与交互一致性收敛（组件变体、间距、状态色、控件复用）；
- 既有组件和交互的重构、性能与可维护性优化；
- 已登记规范偏离与 UI 技术债的清理。

## 不属于本阶段

以下改动原则上进入 P2.0 或需另行确认：

- 新的业务能力与产品功能；
- 新字段类型、新 View 类型；
- OpenAPI 合同、数据模型、持久化 schema 的变更（纯修复性对齐除外，需先行确认）。

## 种子工作项

已登记的已知缺口（来自前轮规范修订与本地审计），执行时按优先级切片推进：

- `styles.css` 中承担面板布局判定的 viewport `@media` 迁移为容器宽度判定（已登记规范偏离）；
- 附件预览、危险确认框等缺样式表面；缺失的 Primary 按钮变体；死 CSS 清理（本地审计清单见 `docs/local/style-audit-2026-09-20/` 等，本地材料仅作线索，正式依据以规范为准）；
- CDP 真机观感复核（P1.5 遗留 #9–#12 项）；
- 各会话新增缺口在「当前交接」中登记。

## 权威次序

用户当前要求 → 本文件阶段范围 → [docs/ui/](../ui/README.md) 规范 → [docs/p1.5/](../p1.5/README.md) 实现合同（已交付行为的有效规范）→ 固定 OpenAPI 事实 → 现有代码与测试。

## 验证

沿用仓库门禁：`npx vitest run`、`npx tsc --noEmit`、`npx eslint src tests`、`npx prettier --check .`、`npm run api:generate` 后零 diff、`npm run build`。UI 观感核验按仓库 AGENTS.md 的 CDP 流程执行。

## 当前交接

- 2026-09：阶段定义，P1.5 已交付封存（见 [P1.5 状态表](../p1.5/status.md)）。种子工作项按上节推进；每个会话在此更新最近交接。
- 审计 `docs/local/ux-audit-2026-09-24.md` 确认项已全部实施完成（本轮用户授权连续推进全部切片）：
  - ✅ Map：空 Leaflet pane 不再截获 Marker 事件；`ready` 后收起瓦片就绪常驻状态条（loading/error/config 仍可见，ready 保留 aria 播报）。已 CDP 真机验证点击/拖拽/hover，提交 `3426920`。
  - ✅ 字段浮层焦点与草稿行焦点：Field Editor 打开经 `setTimeout`+有界重试（真实 click 手势窗口期内 `focus()` 会被静默丢弃）；Tab/Shift+Tab 面板内循环；Esc/外点/宿主滚动关闭并恢复稳定触发源；`closed` 幂等与其他面板对齐；`render()` 保留存活 overlay 不再被 `replaceChildren` 摘除；行内新建提交后焦点落到新记录 cell（不可见则回落新增入口，失败粘性恢复草稿），用户主动移焦后异步结果不抢焦点。已 CDP 验证打开聚焦/Tab 圈/Esc 恢复/render 存活/草稿提交落焦，提交 `2445f02`。
  - ✅ 计数失效：in-page 删除/恢复同步递减 `totalCount`/`unfilteredTotal`（presence 守卫防双减），`replace` 重查不再用旧分母兜底；`3/4 行` 伪筛选态消除。提交 `6dcb989`。
  - ✅ Default View 全量同步 + DisplayPanel 过期草稿：`setDefaultView` 成功后以 `listViews(tableId)` 原子替换 View 列表；DisplayPanel 增加 `hasPendingEdits()`/`isInSyncWith()` 门控，与 Filter/Sort 一致的重建条件。已 CDP 验证默认互斥即时生效，提交 `6dcb989`。
  - ✅ O2 行排序边界：Server `neighbor()` 改用可空扫描（空邻居走 `before ± 1024` 边界路径），含首/尾单锚点集成测试（Server 提交 `5f4827f`）；Plugin 侧 `GridState.moveError` 独立槽位（含 recordId+details），不再被无关成功编辑误清（Plugin 提交 `011fb22`）。
  - ✅ 列头交互重构：单击选整列、双击/Enter 开 Field Editor、Space 选列、ContextMenu 键开列菜单、方向键在列头间移动、拖拽重排带 before/after 指示；排序改由列菜单与 Sort Panel 承载。已 CDP 验证全交互矩阵，提交 `09ab7cd`。
  - ✅ O3 导航两行 + O4 工具栏 `⋯` 收容 + O8 容器响应式：导航固定两行（第一行 Workspace/Base/Table 上下文，第二行 View 页签 + Add/Manage，保留 `+N` 溢出与 tablist 键盘语义）；工具栏宽度不足时 Sort/Display/Undo/Redo 依序收容进 `⋯` 菜单，激活项以徽标提示，菜单项复用原控件 `click()`；布局断点迁往 `.loom-root` 具名 query container（`@container loom`），窄容器 query/status 面板转为锚定宿主 pane 的底部 Sheet。已 CDP 验证全宽/分栏/300px 窄容器、真实 692px 分栏、Map 分栏回归，提交 `c269ab8`。
  - ✅ Filter 渐进披露 + touched 校验：首条条件以裸规则行呈现（合同允许的 rule 根节点），第二条条件才升级为分组，删回单条时根组收敛回裸规则；新建条件行的 value-missing/value-invalid 提示在该行 change 或失焦后才显示，结构性错误保持即时提示；未完成草稿仍不提交 Server；规则/分组移除按钮在文案与可访问名称中注明对象。已 CDP 验证，提交 `002cd59`。
  - ✅ Detail select/date 即选即存：Select/Date 编辑器 change 后立即经 `onFieldEdit` 队列提交并关闭编辑器（与 Checkbox 对齐）；失败保留所选值与字段级错误，焦点回编辑器；MultiSelect 逐选语义未定，维持显式保存/取消。已 CDP 真机验证（建临时 Select/Date 字段，验证后删除），提交 `e3a8f9b`。
  - 决策记录：O5（列头值清单筛选）确认推迟至 P2.0；O6 不做列菜单"设置列宽"项（列宽经表头边缘拖拽与 Display Panel 精确输入）；Detail 标题内联编辑仍为待决 P3 项。
  - 验证基线：`npx vitest run` 66 文件 932 测试全绿；`tsc --noEmit` 0 error；`eslint` 0 error（存量风格 warning）；Server `go test ./...` 含 Postgres 集成测试通过。
- 2026-09-25 修复轮（真实审计 `docs/local/ux-audit-2026-09-25.md`，五问题全修复）：
  - ✅ 环境纠偏：清理上轮误建的 `loomtable-test-pg` 容器与匿名卷；`AGENTS.md` 登记远端 Server 约束（不默认本地起 Docker），提交 `b786f9e`。
  - ✅ P0 编辑锁死 + 编辑视觉残留（同根因）：`finish()` 各退出路径统一就地移除 `.loom-grid-editor` 并重建 cell 显示；编辑器消费键 `stopPropagation` 阻断 Enter 冒泡重入；新增编辑器焦点有界重试（10×50ms，blur 后即停）。CDP 实测连续编辑/blur/Esc/Tab 无锁死无残留，提交 `72b12b2`。
  - ✅ 共享 Table/View Shell：`TableShell` 从 Grid/Map 两个 Renderer 内上提为 `LoomTableView` 单实例（nav DOM 跨 View 不销毁）；两行收敛单行（上下文+视图列表+快捷 tabs+管理动作同层）；「全部视图」按钮开完整 View 列表（aria-current+勾标当前）；删 `+N` 折叠改横滚；`.loom-table-shell-actions` 选择器错配修正，Add/Manage 与 tabs 同为轻量样式。提交 `4cd4122`。
  - ✅ 新增记录简化：删 split caret/菜单/相关 i18n 与 CSS；`+` 行与工具栏按钮直接展开行内草稿；`hasMore` 不再阻断；手动序（`manualSort:true && sort:[]`）草稿落在显式焦点行下且提交后 `moveRecord` 持久化，非手动序一律落已加载末尾；Esc 取消/blur 提交/失败保留草稿恢复焦点；Grid 就绪且焦点空闲时软聚焦首个可编辑 cell（不抢滚动锚点）。提交 `faf92fd`。
  - 新发现待决（审计文档第二节）：F-1 按钮触发菜单覆盖触发器（P3）；F-2 行内创建失败无可见错误提示（P2）；F-3 `Σ` 底部条与工具栏行数重复（P3 待产品决策）；F-4 状态面板模式图标无 roving tabindex（P3）；F-5 Enter 偶发未进入编辑（P3 低置信，未复现）。
  - 验证基线：`npx vitest run` 66 文件 939 测试全绿；`tsc --noEmit` 0 error；`eslint` 0 error；`prettier --check` 通过；`api:generate` 零 diff；`git diff --check` 干净；`npm run build` 成功。
- 2026-09-26 视图管理 + 样式收敛轮（工作区 AGENTS.md Git 规则已按 agent 分域纠偏；Plugin `9bd3e6e..7eab5ec`、Server `4e08bf0..5f4827f` 已推送）：
  - ✅ 视图管理统一进「全部视图」面板：删除 Add/Manage 独立按钮；shell 内绝对定位下拉列视图（低视觉重量、aria-current 当前项、`...` 行菜单：重命名/复制/设为默认/删除/修复），分隔线 + 底部唯一操作「新增视图」直接建默认表格视图（`表格视图`/`表格视图 2`…最小可用编号）并自动选中；行内重命名 Enter/blur 提交、Esc 取消、失败保留输入且 pending 防重入（修复 blur/submit 竞态渲染死循环）；已删视图不再出 UI；空态直建默认 View。CDP 实测面板/改名/复制预填/删除确认取消/默认创建/编号/真删除/窄屏。提交 `c1a5653`。
  - ✅ 控件高度与间距收敛：`--loom-control-compact-height`(28px) 统一 tab/shell-action/toolbar/icon-only 控件；`.loom-nav-host` 加 margin-block-end 拉开 View/Toolbar 间距；Grid viewport 改 flex 列修复小数据假滚动条（实测 scrollHeight==clientHeight）。提交 `dd5ff68`。
  - ✅ HIG 契约：Grid 正式用户名为「表格视图」；写入 Persistent Active Cell 契约（业务态独立于 DOM focus/编辑态，身份=Table+View+Record+Field）与视图面板/无回收站删除模型。提交见 docs 切片。
  - 🔍 Grid 专项审计 `docs/local/grid-ux-audit-2026-09-26.md`（本轮只报告不修）：G-1/G-2 scroll handler 内 focus-restore 误伤（scrollTop 回写焦点行 + DOM focus 偷回 cell，P1 同根因）；G-3 render() 全量重建丢 scrollTop（P1，渲染架构）；G-4 滚到底「+」行被 sticky Σ 条完全遮挡（P1）；G-5 scroll 无 rAF 节流全量重建可见行（P2）；G-6 Esc/aria/单击编辑契约待确认（P3）。
  - 决策记录：View 拖拽排序推迟 P2.0（合同无 position/order 端点，不做本地持久化绕行）；删除视图无回收站 UI、保留行内确认；新增视图类型不做。
  - 验证基线：`npx vitest run` 66 文件 945 测试全绿；`tsc --noEmit` 0 error；`eslint` 0 error；`prettier --check` 通过；`api:generate` 零 diff；`git diff --check` 干净；`npm run build` 成功。

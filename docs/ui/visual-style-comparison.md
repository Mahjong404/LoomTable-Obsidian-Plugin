# Grid 视觉风格对比：duowei-table / teable / LoomTable

数据来源：duowei-table 已安装版本的 `styles.css` 与 README（可逐行核对）；teable 仓库结构（`packages/sdk/src/components/grid`，canvas 渲染架构）与其产品截图；LoomTable 当前 `styles.css`。

**重要架构差异**：teable 的表格是 canvas 逐层渲染（RenderLayer / InteractionLayer / TouchLayer / InfiniteScroller），视觉上是 Airtable 式"画布网格"；duowei-table 与 LoomTable 都是 DOM 网格。因此 duowei 是更直接的参照；teable 主要提供交互模式参照（面板、视图栏、记录展开），视觉细节以 duowei 为准。

## 一、网格线与边框（"无边框"观感的真实来源）

| 项 | duowei-table | teable | LoomTable 现状 |
|---|---|---|---|
| 单元格边线 | `border-inline-end/bottom: 1px solid --mt-grid-line`，其中 `--mt-grid-line = color-mix(border 55%, transparent)` —— 55% 透明度的发丝线 | canvas 画线，默认行分隔线、列线仅在 hover/active 区显现 | `1px solid --loom-border` 全强度边框 |
| 表头底边 | `--mt-grid-line-strong` = 90% 透明度边框 | 同上思路 | 全强度 `--loom-border` |
| 表头背景 | `--mt-header-bg = color-mix(secondary 55%, primary)` —— 半透明的次级背景 | 浅灰表头 | `--loom-bg-secondary` 全不透明 |
| 表头高度 | 36px | ~32–40px | 2.25rem（36px）✓ |
| 外层视口 | 细线外框 | 无外框（画布铺满） | `1px solid --loom-border` |
| 冻结列分界 | `inset -2px 0 0 --mt-grid-line-strong` 内阴影 | 右侧粗线 | `2px solid` + 外阴影（已接近） |

**结论**：两个参考都不是"零边框"，而是"发丝线 + 半透明混合色"。观感来自 `color-mix` 透明度而非删除边框。

## 二、命令栏与按钮

| 项 | duowei-table | teable | LoomTable 现状 |
|---|---|---|---|
| 结构 | `.mt-command-bar` 竖排两行：`__row` 内 `__group` 分区，`--end` 用 `margin-inline-start:auto` 钉右 | 顶部视图页签行 + 工具行，右端钉操作 | 已改造为同构：导航行(context/tabs/actions) + 命令行(start/end) ✓ |
| 普通按钮 | `.mt-command-button`：透明无框，`height:30px`，`border-radius`，hover `--mt-hover-bg`，`color:--text-muted→normal` | 同型 ghost 按钮 | `.loom-button` 有边框+底色 |
| 主按钮 | `.mt-command-button--primary`：`--interactive-accent` 实底 + `--text-on-accent`（截图中紫色"新增行"） | 实底主按钮 | "新增记录"是普通按钮 |
| 工具按钮激活态 | `.mt-tool-button.is-active`：`accent 12%` 底色 + accent 文字 | 同类 | 无激活态样式 |
| 分隔线 | `__divider`：1px×18px 竖线 `--mt-grid-line` | — | 无 |
| 窄屏降级 | <1100px 隐藏工具按钮 label 只留图标；<760px 连"新增行"label 也隐藏 | 响应式收缩 | 有窄屏媒体查询但策略不同 |
| 保存状态 | `.mt-save-status` **固定 `width:6.5em`** + `text-overflow:ellipsis`（注释明确：防止整行抖动）+ 左侧 6px 状态点（saving 脉冲/saved 绿/error 红/conflict 橙） | 角落状态指示 | 已固定 `7rem` 宽 + 状态点 ✓ |
| 记录数 | "0 条记录" 在右端、save-status 旁 | 底部状态栏 | "3 行" 在 end 区 ✓ |

## 三、视图页签

| 项 | duowei-table | teable | LoomTable 现状 |
|---|---|---|---|
| 形状 | `height:28px` 圆角 6px 药丸，透明底 | 下划线式页签（web 惯例） | 有边框的按钮式 |
| 激活态 | `accent 12%` 底色 + accent 文字 + 600 字重 + 页签图标变 accent | 底部 accent 指示条 | aria-selected 样式 |
| 溢出 | `.mt-view-overflow` "+N" 圆角胶囊折叠多余页签 | 滚动/折叠 | `overflow-x:auto` 滚动 |
| 悬浮菜单 | 页签内 hover 显现 `__menu` ⋯ 按钮（改名/复制/删除入口） | 右键/下拉菜单 | "管理视图"集中面板 |
| 新建 | tab 行末尾 "+" 按钮 | "+" 按钮 | "添加视图"按钮 ✓ |

## 四、行与单元格

| 项 | duowei-table | teable | LoomTable 现状 |
|---|---|---|---|
| 行高 | 默认 ~32px，"行高"工具可切（紧凑/中/高） | 行高可选 4 档 | `rowHeight` 由显示配置控制 |
| 行号列 | sticky 左，`--text-faint` 11px tabular-nums，`cursor:grab`（拖行排序） | 行号列 + checkbox | sticky 行号列 ✓ |
| 行内动作 | `.mt-row-expand` 悬浮显现（行号格内"展开"图标），不常驻 | hover 行首显现展开箭头 | ↗ 打开 + × 删除按钮常驻 |
| 单元格选中 | `is-selected` 用 `--mt-selection-bg = accent 10%` 底色 + `::before` 四边 2px 内边框（注释：内画防遮挡） | accent 边框高亮 + 填充柄 | `:focus-visible` outline |
| 活动单元格 | `is-active` 高亮 + `.mt-fill-handle` 9px 圆形填充柄（右下角，accent 实心+白边） | 同款填充柄 | 无填充柄（范围选择本期未做） |
| 编辑态 | `is-editing` 编辑器浮于单元格，无边框内嵌 | 同 | 单元格内编辑器 ✓ |
| 保存态 | `is-saving/saved/error/conflict` 用 `::after` 角标/底色微光 | cell 级状态点 | `data-edit-state` 底色 |
| 必填空值 | `is-required-empty` 特殊底色 | 必填标记 | 无（无 required 概念） |
| 列头内容 | 类型图标 + 字段名 + 必填星 + 描述 icon + hover ⋯ 列菜单 | 类型图标 + 名 + ▾ | 纯文本字段名 |
| 列头选中 | `is-selected` 整列高亮（点列头选列） | 同 | 无列选择 |

## 五、记录详情面板

| 项 | duowei-table | teable | LoomTable 现状 |
|---|---|---|---|
| 形态 | `.mt-record-detail`：absolute 右侧，`top:46px`（避开命令栏），`width:min(390px,88vw)`，左边框 + `-8px 0 24px rgba(0,0,0,.08)` 投影 | 右侧记录卡 / 展开行 | 已改右侧 absolute 浮层 `min(26rem,88%)` ✓ |
| 模态变体 | `--modal`：居中 `min(640px,92vw)` 圆角 12px + 深色遮罩 `rgba(0,0,0,.32)` | 弹窗 | 无模态变体 |
| 移动端 | `body.is-phone` 下全屏 sheet | 响应式 | 窄屏 bottom-sheet ✓ |
| 行内编辑 | Detail 内字段行内编辑，不新开页 | 同 | ✓（已是） |

## 六、颜色与主题策略

| 项 | duowei-table | LoomTable 现状 |
|---|---|---|
| 主题变量 | **直接用 Obsidian 原生变量**（`--background-primary`、`--text-muted`、`--interactive-accent`、`--background-modifier-*`）+ 少量 `--mt-*` 派生 | `.loom-root` 把 Obsidian 变量映射为 `--loom-*`（styles-audit 要求） |
| 透明度手法 | 大量 `color-mix(in srgb, X%, transparent)` | 目前主要直接引用 |
| 选中/激活 | accent 10–12% 混合色 | accent 色直接使用 |

结论：保持 `--loom-*` token 架构（audit 约束），在 token 定义层引入 `color-mix` 即可达到同等观感——观感完全可复制，只是写法位置不同。

## 七、teable 独有能力（LoomTable 未覆盖，供参考不照搬）

- canvas 网格 → 任意行列数流畅滚动、单元格内富渲染（进度条、评分星、成员头像）
- 拖拽列宽/列序、行拖拽排序、范围选择 + 填充柄批量填充
- 看板/画廊/日历等多视图类型；字段类型更全（公式、汇总、关联、成员）
- 右键上下文菜单（截图 1 中 duowei 也有：编辑/复制/填充/批量修改/单元格样式/打开详情/绑定笔记/插入行/删除行列）

---

## 决策点（请你定）

> 已按"无边框发丝线 + ghost 工具按钮 + hover 显现行内动作 + accent 激活态"完成第一版模仿（见下节）。以下是影响更大、需要你拍板的点：

### D1. 视图页签形态
- **A（duowei 式）**：圆角药丸，激活 = accent 12% 底 + accent 字重 600。**已应用此方案。**
- B（teable 式）：下划线指示条页签——更"文档感"但 Obsidian 内不常见。
- C：维持现状有框按钮。

### D2. 列头是否加字段类型图标

> **已实施**：`src/ui/field-type-icon.ts`，10 种字段类型 → Lucide 风格 stroke SVG，0.875rem/`--loom-text-faint`；排序列图标置于排序按钮内。

- **A**：加（duowei/teable 都有，扫描性更好，需要一套 14×14 图标映射 ~15 种字段类型）
- B：维持纯文本（省事，列头更矮更干净）

### D3. 行内动作（打开详情/删除）显现时机

- **A（duowei 式）**：行 hover / focus-within 时才显示 ↗ 和 ×，平时只显示行号。**已应用。**
- B：常驻（现状改进前）。

### D4. 单元格选中/活动态
- **A（duowei 式）**：活动单元格 = accent 10% 底色 + 2px 内边框，列头选中整列高亮——需要新增 selection 状态模型
- B：维持 `:focus-visible` outline（现状）——够用但不够"表格感"

> **已实施 A**（单元格级）：`--loom-selection-border` token + `.loom-grid-cell:focus/:focus-within` = `--loom-selection-bg` 底 + 2px accent 内环；冻结聚焦用不透明混色防透底。整列高亮未做（选中模型仍单元格级）。

### D5. "新增记录"按钮层级
- **A（duowei 式）**：accent 实底主按钮（紫色"新增行"位）——**已应用。**
- B：普通工具按钮。

### D6. 右键上下文菜单

- duowei 有完整右键菜单（编辑/复制/清空/填充/样式/详情/绑定笔记/插行/删行列）；teable 也有。
- **A**：本期加基础版（编辑/复制/删除行/打开详情）——工作量中等
- B：后续迭代再加——**建议**（先把视觉统一，菜单是独立功能块）

> **已实施 A**：`src/ui/context-menu.ts`，单元格菜单 = 编辑/复制/清空内容/打开详情/删除记录（带图标、危险项红色、禁用态、Esc/外点/滚动关闭、↑↓ 循环）；行号单元格 = 打开详情/删除。填充/样式/插行等高级项未做。

### D7. 命令栏分隔线与按钮密度
- **A（duowei 式）**：工具组间 1px 竖分隔线，按钮 30px 高 gap 1–2px 紧凑排列——**已应用。**
- B：维持当前间距。

### D8. Detail 面板模态变体

- **A**：仅右侧浮层（现状，贴 duowei 默认）
- B：加 `--modal` 居中变体用于"放大查看"场景——暂不建议

## 已应用的模仿（本轮）

1. 网格发丝线：`--loom-grid-line = color-mix(--loom-border 55%, transparent)`、`-strong = 90%`、`--loom-header-bg = color-mix(secondary 55%, primary)`
2. 工具栏/页签内按钮 ghost 化：无边框、hover 底、激活 accent 12%
3. "新增记录"升为主按钮（accent 实底）
4. 行内 ↗/× 仅行 hover/focus 显现
5. 视图页签改药丸式 + accent 激活
6. 命令组之间竖分隔线
7. 工具栏/页签/菜单统一图标（`src/ui/icons.ts`）：筛选/排序/显示/新增/回收站/刷新按钮 + 视图页签 grid|map 图标 + 菜单项图标
8. 空白区填充网格线（canvas `min-height:100%` + 计算行列边界的线性渐变背景，数据行不透明底自然遮盖）
9. 网格底部行内"新增记录"行（无更多分页 + ready 时出现，点击打开创建面板）

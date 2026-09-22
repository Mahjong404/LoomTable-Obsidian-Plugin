# LoomTable UI Design System

> 本文档是 LoomTable 视觉与样式体系的规范性来源：Token、CSS 层次、组件分层、命名空间、状态表达、视觉基调和依赖策略。通用交互规则以 [LoomTable Interaction HIG](./interaction-hig.md) 为准；各特性规范见 `grid-spec.md`、`map-spec.md`；文档职责划分与规范层级见 [UI 文档入口](./README.md)。本期范围、Gallery 与实现顺序见 [P1.5](../p1.5/README.md)。

## 目标

LoomTable 的 UI 使用 Obsidian 的主题语义，同时保留自己的组件行为、状态和命名空间。用户应用任意 Obsidian 主题后，LoomTable 应继承该主题的整体视觉，而不是只适配某一个主题。

## 视觉基调

LoomTable 的视觉气质：安静、精确、紧凑、高密度但可读、中性、面向数据。差异化来自更好的层级、间距、密度、对齐和交互反馈，不来自装饰。

- 不发明确立于 Obsidian 的视觉身份；界面应读起来像 Obsidian 的一部分，而不是嵌入的独立软件。
- 装饰性元素（大圆角、重阴影、渐变、玻璃拟态、装饰性背景、营销化排版）不属于本体系。
- 组件视觉重量与操作频率成反比：高频数据操作低视觉重量，唯一 Primary 才允许强调。

## CSS 层次

```text
Obsidian Theme Variables
        ↓
Loom Semantic Tokens
        ↓
Loom Primitives
        ↓
Loom Patterns
        ↓
Grid / Map / Record Views
```

当前实现为单一 `styles.css`，内部按上述层次分区组织（token 块 → primitives → 组件 → 视图 → 响应式/降级）。新样式按层次归入对应分区，不按文件或组件新建顶层命名空间。

## Token 规则

组件只使用 `--loom-*` 变量；`--loom-*` 变量映射到 Obsidian 变量并提供安全 fallback：

```css
.loom-root {
  --loom-bg-primary: var(--background-primary, #ffffff);
  --loom-bg-secondary: var(--background-secondary, #f7f7f7);
  --loom-bg-hover: var(--background-modifier-hover, #eeeeee);
  --loom-text-normal: var(--text-normal, #222222);
  --loom-text-muted: var(--text-muted, #777777);
  --loom-border: var(--background-modifier-border, #dddddd);
  --loom-accent: var(--interactive-accent, #7c3aed);
  --loom-radius-sm: var(--radius-s, 4px);
  --loom-radius-md: var(--radius-m, 8px);
  --loom-font-body: var(--font-text, sans-serif);
  --loom-font-mono: var(--font-monospace, monospace);
}
```

组件不得直接依赖某个主题的颜色值、字体文件或品牌资源。

## 命名空间

所有 LoomTable CSS 必须位于 `.loom-*` 命名空间：

```css
.loom-root {}
.loom-toolbar {}
.loom-button {}
.loom-grid {}
.loom-cell {}
.loom-cell[data-state="editing"] {}
```

禁止在插件 CSS 中全局覆盖：

```css
button {}
input {}
textarea {}
.workspace {}
.markdown-preview-view {}
```

禁止使用 `transition: all`。涉及布局测量、SVG、编辑器光标和虚拟化 Grid 的元素不得使用会改变尺寸的全局动画。

## 图标

图标按语义分三层来源，不得混用：

| 层 | Provider | 用途 |
|---|---|---|
| 系统 UI 图标 | Obsidian 图标体系 / Lucide 风格 stroke SVG（经 `setIcon` 渲染；`src/ui/icons.ts`、`src/ui/field-type-icon.ts`） | 工具栏、按钮、字段类型、状态标记等界面内置图标 |
| 用户可选图标 | Tabler Icons | 未来开放用户为 View、字段等自选图标时的候选集 |
| 领域专属图标 | LoomTable 自绘 SVG | 仅用于现成图标无法表达 LoomTable 领域语义的场景 |

原则：

- 本文档只规定图标 provider、语义分层和使用原则，不维护图标名称清单；具体图标选择在实现层进行。
- 三层保持同一 stroke 视觉语言；自绘 SVG 必须与系统图标协调。
- 仅当 Tabler 明显更适配时，系统 UI 图标可采用 Tabler。
- 组件不得自行更换图标风格、引入新图标库或扩大自绘范围；新增图标需求先归入对应层。
- 图标的可访问名称、Tooltip 和键盘说明规则见 [Interaction HIG](./interaction-hig.md#基础组件规范)。

## 控件分工

原则：宿主控件优先；宿主控件明显不胜任复杂数据场景时自建 Loom 组件，不为“原生感”降级交互。

| 场景 | 实现 |
|---|---|
| Settings | Obsidian 原生 Setting |
| Command | Obsidian Command |
| Notice | Obsidian Notice |
| Menu | Obsidian Menu |
| 基础 Modal | Obsidian Modal |
| Button / Input | Loom 包装和样式 |
| Grid | Loom 自定义 DOM |
| Cell Editor | Loom Field Editor |
| Filter Builder | Loom 自定义 DOM |
| Record Detail | Loom 自定义 DOM（桌面 Detail Panel / 窄布局 Sheet） |
| Field Type Picker / Relation Picker 等复杂选择器 | Loom 自定义 DOM |
| Map View | Loom Map UI + 随包 Leaflet Adapter |

## 组件状态

需要通过 `data-state` 或等价状态表达：

```text
default
hover
focus
active
disabled
loading
readonly
dirty
error
conflict
offline
```

状态必须能被键盘、屏幕阅读器和自动化测试观察到，不能只依赖颜色变化。

## 组件实现

实现使用 TypeScript 工厂函数和原生 DOM（`src/ui/`）：

```ts
createLoomButton(options)
createLoomPopover(options)
createFieldEditor(field, value, context)
createRecordDetail(record, context)
```

不引入 React 或其他 UI 框架，不引入组件库，不复制完整主题 CSS。未来出现第二个前端消费者时，再评估独立 Web Adapter。

### 依赖策略

- UI 工作不得新增 runtime 依赖；样式与交互问题优先在现有 native DOM + token 体系内解决。
- 定位类能力（popover/tooltip/锚定浮层定位）如确有需要，可单独评估通用定位库，但定位库不决定视觉。
- 任何框架级迁移（React、大型表格库）必须先有实际代码证明现有架构存在明确维护问题，并经显式批准。

## 响应式策略

布局适配以可用容器宽度为准。空间/布局响应与环境/交互响应的完整规则（含允许使用的环境能力 media query 类型）以 [HIG 容器响应式节](./interaction-hig.md#响应式主题与可访问性) 为准，本文不重复维护清单。

- 宽容器：完整 Grid、工具栏、固定列和键盘操作。
- 中等容器：工具栏可折叠，详情面板可收起。
- 窄容器：记录详情和 Sheet 优先，Grid 减少并行操作；字段不强行压缩，允许横向滚动或切换详情模式。
- 移动端视口：记录卡片、详情编辑和简化工具栏；必要时支持横向 Grid；触控目标放大。
- 浮层形态（Popover ↔ Sheet）走单一判定接缝、逐面板 opt-in，规则见 HIG。
- Map View：所有容器支持触控缩放、拖动和 Marker 选择；Provider Attribution 固定在地图可见区域内，不得被工具栏、详情面板或窄屏布局遮挡，也不得只放进二级菜单。

已知偏离：`styles.css` 现存少量 viewport 宽度布局查询承担面板适配，与容器宽度原则不符。新样式 MUST 按容器宽度适配；存量查询在后续实现阶段逐步迁移，不在文档任务中处理。

## Component Gallery

Plugin 内提供开发用 Component Gallery，展示每个组件的：

- 默认、Hover、Focus、Active、Disabled。
- Loading、Error、Readonly、Dirty、Conflict。
- Light/Dark 主题变量环境。
- 长文本、空值和窄面板。
- 键盘操作和触控操作。

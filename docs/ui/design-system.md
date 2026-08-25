# LoomTable UI Design System

> 本文档记录 UI Token、CSS 层次和组件实现建议。规范性行为、状态、键盘、触控、可访问性和验收要求以 [LoomTable Interaction HIG](./interaction-hig.md) 为准；实施顺序见 [HIG 落地计划](./interaction-hig-rollout.md)。

## 目标

LoomTable 的 UI 使用 Obsidian 的主题语义，同时保留自己的组件行为、状态和命名空间。用户应用任意 Obsidian 主题后，LoomTable 应继承该主题的整体视觉，而不是只适配某一个主题。

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

建议的样式文件层次：

```text
styles/
├── tokens.css
├── primitives.css
├── patterns.css
├── grid.css
├── map.css
└── responsive.css
```

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

## 控件分工

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

第一阶段使用 TypeScript 工厂函数和原生 DOM：

```ts
createLoomButton(options)
createLoomPopover(options)
createFieldEditor(field, value, context)
createRecordDetail(record, context)
```

不引入 React，也不复制完整主题 CSS。未来出现第二个前端消费者时，再评估独立 Web Adapter。

## 响应式策略

- 桌面：完整 Grid、工具栏、固定列和键盘操作。
- 平板：保留 Grid，工具栏和详情面板可折叠，支持触控。
- 手机：使用记录卡片、详情编辑和简化工具栏；必要时支持横向 Grid。
- Map View：所有设备支持触控缩放、拖动和 Marker 选择。
- Provider Attribution 固定在地图可见区域内，不得被工具栏、详情面板或窄屏布局遮挡，也不得只放进二级菜单。
- 窄面板不强行压缩所有字段，而是允许横向滚动或切换详情模式。

## Component Gallery

Plugin 内提供开发用 Component Gallery，展示每个组件的：

- 默认、Hover、Focus、Active、Disabled。
- Loading、Error、Readonly、Dirty、Conflict。
- Light/Dark 主题变量环境。
- 长文本、空值和窄面板。
- 键盘操作和触控操作。

# LoomTable UI Design System

> 本文档是 LoomTable 视觉与样式体系的规范性来源：Token、CSS 层次、组件分层、命名空间、状态表达、视觉基调和依赖策略。通用交互规则以 [LoomTable Interaction HIG](./interaction-hig.md) 为准；各特性规范见 `grid-spec.md`、`map-spec.md`；文档职责划分与规范层级见 [UI 文档入口](./README.md)。当前实施范围见 [P1.6](../p1.6/README.md) 与 [Wave 1.5](../wave1.5/README.md)；P1.5 保留已交付合同。

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

按组件角色通过 `data-state` 或等价状态表达适用状态；不要求每个组件拥有全部状态组合：

```text
default
hover
active
disabled
loading
readonly
dirty
error
conflict
offline
```

状态必须能被键盘、屏幕阅读器和自动化测试观察到，不能只依赖颜色变化。DOM 焦点使用可见的宿主 `:focus-visible`，不新建 Loom Focus variant。Grid Current/Selected 与系统写入状态分别按 HIG/Grid Spec 表达；Loading/Error/Conflict 不作为通用 Cell 装饰。

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

容器适配通过 `.loom-root` 上的具名 query container（`container-name: loom`）实现；工具栏标签折叠、上下文面包屑、导航与 query/status 面板规则使用 `@container loom` 按 pane 宽度生效。Grid 工具栏在容器宽度不足时把 Sort、Display、Undo、Redo 收容进 `⋯` 菜单（Create、Filter、Search、保存状态保留主行，被收容的激活项以徽标提示）；导航为单行——`Workspace / Base / Table` 上下文面包屑、「全部视图」入口与 View 页签同行，页签横向滚动且不用 `+N` 折叠；窄容器下上下文面包屑折叠为 compact toggle。query/status 面板在窄容器内以宿主 pane 为边界转为底部 Sheet。

## Component Gallery

Plugin 内提供开发用 Component Gallery，展示每个组件的：

- 各角色适用的 Default、Hover、Active、Disabled，以及真实键盘 focus-visible。
- Loading、Error、Readonly、Dirty、Conflict。
- Light/Dark 主题变量环境。
- 长文本、空值和窄面板。
- 键盘操作和触控操作。

## 批准组件的视觉合同

Wave 1 保持 Approved/Frozen；Wave 1.5 视觉基线已批准。此节定义目标外观，不声称生产组件已经全部对齐；当前可实施部分与 API/Future 状态见 [Wave 1.5](../wave1.5/README.md)。

- Button/IconButton 按 Quiet、Neutral、Primary、Danger 和适用 Disabled/Loading 角色使用现有 Token。Toolbar 打开态保持中性，具有有效条件的激活态使用 accent，两者可同时存在。
- Menu 的单选/多选状态与命令分开；只有选择项显示对应 Check。Check optical glyph 为 14px、描边 1.75px，仅适用于该图标；不把其他系统图标统一改为同样描边。
- Drag Handle 使用透明 28px 稳定槽。Pin 采用同一 14px 图形的 Outline/Filled 中性 metadata 样式，保持槽位；More 为 28px target，与 8px resize lane 分开。Row Detail 为 Lucide maximize-2 透明 28px target，hover 仅加强 glyph accent。
- Clear 使用 Quiet，规则移除用 X，Option 删除用 Trash；图标表达真实操作，所有 icon-only target 都有实际 label/tooltip。
- Choice Tag 高 20px，单行、ellipsis 与 +N，在固定 Grid 行高中保持稳定；完整值通过可访问说明/详情获得，不靠换行撑高 Cell。
- 所有浮层继承 owner 的 Loom Token 和两主题；body portal 必须有明确主题桥接，不能依赖不存在的祖先样式。Font 使用宿主 body token，数字使用 tabular-nums，不捆绑设计样本字体。

### Choice 色板

Grid、Picker 和历史 typed renderer 使用同一背景/前景 token 对。下表是批准的 fallback 值，只在 Token 定义层维护；组件不硬编码第二套色板。每个主题独立定义背景与前景，标签始终有文字；颜色不用于代替 Current 或系统保存状态。新三色 writer 仍受 [G1](../wave1.5/api-boundary.md#g1--12-color-write-compatibility) 约束，reader 对未知色保值并安全显示。

| Color | Light background / foreground | Dark background / foreground | 写入范围 |
| --- | --- | --- | --- |
| gray | #F0F1F4 / #4D5663 | #47515F / #E0E6EE | 当前 9 色 |
| red | #FCE8E8 / #9B323C | #7A3544 / #FFDCE2 | 当前 9 色 |
| orange | #FCEBDD / #985017 | #784725 / #FFE0B9 | 当前 9 色 |
| yellow | #FBF0C7 / #786006 | #665A22 / #FFEB9C | 当前 9 色 |
| lime | #EFF3D6 / #566720 | #526820 / #E7F5B0 | G1 后启用 writer |
| green | #E6F3E7 / #376946 | #2B6343 / #BDF2CE | 当前 9 色 |
| cyan | #DEF3F4 / #21686D | #1E5D6B / #B4EDF4 | 当前 9 色 |
| blue | #E7EEFC / #345BA4 | #2A5484 / #CEE2FF | 当前 9 色 |
| indigo | #E7E8F9 / #5057A6 | #484789 / #DEDEFF | G1 后启用 writer |
| purple | #EEE6F8 / #6F478F | #603E82 / #E8D4FF | 当前 9 色 |
| pink | #F9E5EF / #98476B | #7A3D60 / #FFD6EC | 当前 9 色 |
| brown | #F0E8E1 / #7C5845 | #62483B / #EED4BE | G1 后启用 writer |

### Picker 视觉合同

下表量值均以 Picker 左上角为原点。Date 6 个 master、Time 12 个 master 的固定设计尺寸均为 280×325；Time/DateTime/12h 是 Future/API-gated。容器承载形态和焦点按 HIG，不通过压缩内部几何解决窄 Pane。

| 部位 | 批准值 |
| --- | --- |
| Root | 280×325 |
| Header | x14/y8/w252/h36 |
| Footer | x14/y276/w252/h28；Clear/Confirm 各 56×28，gap8；中心 x138/x202，右边缘 x258 |
| Footer leading | 72px；Time mode target 28×28，中心 Picker x50；glyph 22×22；Date 使用 Today |
| Date 标题 | 年/月 15px/600、line22，Quiet target 高28；Year slot112、Month64；无 caret 或常驻边框 |
| Calendar | Day 7×6、day cell36×32；Month3×4；Year4×5、每页20年 |
| Time body | x14/y48/w252/h220 |
| Time anchor | 130×36，Header local x61；HH local x0/w56、colon x60.5/w9、MM x74/w56；Picker HH x75、MM x149，colon 中心 x140 |
| Time 字体 | HH/MM 32px/600、line36；colon28px/500、line36；Clock labels13px/500 |
| AM/PM | 独立 trailing control，Picker x210/y8/w40/h36；不参与 time anchor 居中计算；minute hit gap5、右侧 inset30 |
| AM/PM 内容 | 字12px/600、line18；indicator x2/w36/h18/r4，AM y0/PM y18；浅 accent 背景、选中文字 accent，未选中中性可读 |
| Wheel | 两列各 5×36px 可见行，窗口180px；中心选中带固定，不随数字滚动 |

### Clock Pointer Geometry — Future

Hour/Minute 使用同一公式，起点始终为 Clock 中心，终点为活动 ring 的 marker 中心。参数按活动环变化，不按示例分钟补偿。

| 参数 | 批准值 |
| --- | --- |
| Dial envelope | 216×216；现有圆形 surface 可见直径212 |
| 中心 | Dial(108,108)，Body(126,110)，Picker(140,158) |
| Label / active ring | 外环 R94；24h 内环 R62；12h Hour 与 Minute 使用外环 R94 |
| Pointer length | 24h Hour 按活动环为94/62；12h Hour94；Minute 所有0–59统一94 |
| Hand stroke | Hour/Minute、两主题统一1.5px，消费 accent Token |
| Selected marker radius | Hour12；Minute6；中心点 radius2.5 |
| 输入 dead zone | R28；是 hit policy，不是可见空白或 pointer 起点 |
| 24h ring hit threshold | R78 附近 ±4px hysteresis；与视觉 R94/R62 分开 |

以12点为0°：θ=minute×6° 或 (hour mod12)×30°，P=C+R×(sinθ,−cosθ)。28分钟为168°，Dial endpoint=(127.543699,199.945874)。数字与指针前景层应保持可读；所有60分钟、跨0°与两环输入的真实比例和命中留到 Runtime QA。

# LoomTable Interaction HIG

## 目标与范围

本文档是 LoomTable Obsidian Plugin 的规范性 UI/UX 文件，定义界面、交互、状态、可访问性、主题适配和组件验收规则。

P1.5 的功能范围和自动化验证方式由 [P1.5 实现要求](../p1.5/README.md) 限定。本文的后续产品示例不自动成为本期任务；不要求真实 Obsidian、设备矩阵、公共 Provider 或截图证据。

本文档适用于：

- Grid/表格视图；
- Map/地图视图；
- Record Detail/记录详情；
- Field Renderer/字段渲染器；
- Field Editor/字段编辑器；
- Filter、Sort、Toolbar、View Tabs；
- Save Status、Conflict、Offline、Error、Loading 等状态；
- 未来新增的 View、组件和移动端界面。

本文档不定义：

- Server API、数据库结构和字段值合同；
- 实施顺序、版本优先级和发布批次；
- Dashboard/仪表盘的完整组件设计；
- 具体实现框架或 CSS 文件组织。

`docs/ui/` 内各文档的职责划分与规范冲突的裁决顺序见 [UI 文档入口](./README.md)。字段语义、View 数据合同、Mutation 和错误合同以 LoomTable Server 文档和 Plugin Client Contract 为准。

## 规范关键词

- **MUST**：必须遵守。不符合时不得将新组件或新 View 作为完成交付。
- **SHOULD**：默认遵守。确有必要偏离时，必须在对应组件或 View 文档中说明原因。
- **MAY**：可选能力，不构成所有实现的要求。

## 产品与平台原则

### Obsidian Native 与 LoomTable 风格

LoomTable 采用“Obsidian Native 基础 + LoomTable 数据工作台组件”的混合模式：

- MUST 使用 Obsidian 的主题语义、字体环境和平台习惯作为基础；
- MUST 保证 Obsidian Native Light/Dark 下正常显示和交互；
- 自定义 Grid、Field Editor、Toolbar、Record Detail 等组件 SHOULD 形成一致的 LoomTable 风格；
- 自定义组件不得让 LoomTable 看起来脱离 Obsidian；
- 主题适配问题无法完全避免时，MUST 优先保证 Obsidian Native 正常显示；
- 不得为了适配某一个第三方主题而破坏其他主题或覆盖 Obsidian 全局样式。

### 数据工作台原则

- 数据密集区域优先保证可读性、稳定焦点和高效操作；
- 复杂配置采用渐进披露，不把所有高级选项同时堆在主界面；
- 用户必须能知道当前数据是否已保存、是否只读、是否冲突或是否需要修复；
- 危险操作必须可恢复、可撤销或明确确认；
- Server 是 Record、Field、View 和 Attachment 元数据的事实来源；
- UI 不得用本地缓存或视觉成功状态伪造 Server 成功；
- 新 View 和新组件必须复用既有状态、焦点和错误语义。

### 设计优先级

当设计目标相互冲突时，按以下优先级裁决（高在前）：

1. 交互正确性；
2. 数据完整性；
3. Obsidian 宿主一致性；
4. 信息密度；
5. 多维表格工作流效率；
6. 可访问性；
7. 响应式与窄面板可用性；
8. 视觉打磨；
9. 装饰性美观。

装饰性美观 MUST NOT 凌驾于前七项。组件的精致化通过层级、间距、密度、对齐和反馈质量实现，不通过装饰性视觉元素实现。

### 桌面与移动端

LoomTable 使用双模式交互：

- 桌面端以键盘、Grid、Popover 和 Detail Panel 为主；
- 移动端以触控、Record Detail、Sheet 和卡片化信息为主；
- 两端 MUST 使用相同的数据语义、校验、保存和冲突逻辑；
- 移动端不得只是把桌面 Grid 按比例压缩；
- 窄的 Obsidian Workspace Pane 即使位于桌面端，也必须能进入窄布局。

## 领域术语

| 领域对象 | 正式中文 | 英文/内部标识 | 说明 |
|---|---|---|---|
| Table | 数据表 | Table | 记录和字段的容器 |
| Grid View | 表格/表格视图 | Grid | 默认数据浏览和编辑 View |
| Map View | 地图/地图视图 | Map | Location 数据的地理展示 |
| Dashboard View | 仪表盘 | Dashboard / `dashboard` | 由统计和分析组件组成的总览 View |
| Record | 记录 | Record | 数据表中的一条数据 |
| Field | 字段 | Field | 一种值的定义 |
| Location | 地点 | Location | 可包含地址、名称和坐标的值 |
| Relation | 关联记录 | Relation | 指向其他 Record 的关系 |
| Attachment | 附件 | Attachment | 指向文件内容的引用 |

规则：

- Table 在用户界面中使用“数据表”，避免与“表格视图”混淆；
- 默认 View 使用“表格”，完整描述使用“表格视图”；
- `Dashboard` 的中文使用“仪表盘”；
- 不使用“看板”或 `Kanban View` 指代 Dashboard；
- 不引入 `Tag` 字段或 Tag 领域对象；Select/MultiSelect 的 Chip 只是展示表现；
- 未来传统按状态分列、拖动卡片的 Kanban 必须另行定义，不得复用 Dashboard 语义。

## 视觉基础

### 语义 Token

组件 MUST 只依赖 `--loom-*` 语义 Token。Token 再映射到 Obsidian 主题变量并提供安全 fallback。

至少需要覆盖：

- 页面、次级表面和浮层背景；
- 正常、弱化和反色文字；
- 边框、分隔线和 Hover 背景；
- 强调、焦点、成功、警告、错误和冲突；
- 主次按钮和危险按钮；
- Grid 行高、控件高度、间距和圆角。

组件不得直接依赖某个主题的固定颜色、字体文件或品牌资源，也不得把 CSS 颜色写入 Field 数据或 Option 数据。

### 几何与密度

- SHOULD 使用有限的间距级别：`4 / 8 / 12 / 16 / 24`；
- SHOULD 使用 `radius-sm` 和 `radius-md` 两级普通圆角；
- 胶囊形只用于 Select/MultiSelect Option、状态标记或同类紧凑语义元素；
- 普通按钮、输入框、Popover 和 Panel 不使用过大的圆角；
- 桌面控件以紧凑为主，触控控件 MUST 保留足够的触控目标；
- Grid 行高使用 `compact / standard / comfortable` 语义，不在各 View 中重新发明名称；
- 阴影主要用于 Popover、Sheet、Modal 等浮层；普通 Grid、Toolbar 和 Detail 依靠背景、边框和间距形成层级。

### CSS 约束

- 所有 LoomTable CSS MUST 位于 `.loom-*` 命名空间；
- 不得使用全局 `button {}`、`input {}`、`textarea {}`、`.workspace {}` 覆盖；
- 不得使用 `transition: all`；
- 动画不得改变虚拟化 Grid、编辑器光标或布局测量所依赖的尺寸；
- 必须支持 `prefers-reduced-motion`；
- 状态不能只依赖颜色或动画表达。

## 基础组件规范

### 原生控件

- Button、Input、Select、Textarea MUST 优先使用原生语义元素；
- 不得使用可点击的 `div` 代替 Button；
- 每个控件 MUST 有可访问名称；
- Loom 组件只提供 `.loom-*` 包装、Token 和状态样式；
- 控件尺寸 SHOULD 限制为 `compact / default / touch`；
- 组件不得隐藏浏览器和 Obsidian 已有的基本键盘行为，除非提供等价行为。

### 操作层级

操作分为四类：

- **Primary**：当前区域的主要动作；
- **Secondary**：普通辅助动作；
- **Quiet/Icon**：低干扰操作，必须有 Tooltip 和可访问名称；
- **Danger**：删除、覆盖、清空等危险动作。

一个操作区域 SHOULD 只有一个 Primary。Danger 不得与普通操作使用相同的视觉层级。

### 图标

图标 provider、语义分层和使用原则的规范性定义见 [Design System 图标节](./design-system.md#图标)。

### Tooltip

- 只有图标的操作 MUST 有 Tooltip；
- Tooltip 不是唯一的可访问名称，元素同时 MUST 有 `aria-label` 或等价语义；
- Tooltip 应说明动作，不重复整段状态文案；
- 键盘聚焦时也必须能获得同等说明；
- 主要操作不得只存在于 Tooltip 中；
- Tooltip 的出现应有短暂延迟，避免快速移动时闪烁。

### Popover、Sheet 与 Modal

- 桌面端优先使用 Popover；
- 移动端优先使用 Sheet；
- Modal 只用于危险确认、阻塞状态或不可中断的复杂操作；
- 打开后焦点必须进入容器；
- Esc/显式关闭后焦点返回有效触发控件或稳定替代位置；外点、Tab 离开和上下文切换尊重用户的新焦点目标；
- `Esc` 必须关闭可取消的浮层；
- 浮层嵌套时 `Esc` 只关闭最上层：如 View `...` 子菜单打开时第一次 `Esc` 关子菜单并把焦点还给 `...` 触发器，第二次 `Esc` 才关闭「全部视图」面板并把焦点还给面板触发器；外点关闭浮层不得抢走用户刚点击目标的焦点；
- 有未提交草稿时，点击外部、系统返回或下拉关闭不得静默丢弃修改；
- 浮层中的 Primary、Cancel 和 Danger 操作位置应稳定。

## View Shell 与 Toolbar

### View 默认与条件创建

- 新建数据表时默认只创建一个表格视图；
- 「全部视图」面板中的“新增视图”先在面板下半区就地展开类型选择（表格视图 / 地图视图），选中类型后才创建，不弹配置表单；
- 表格视图按 `表格视图`、`表格视图 2`、`表格视图 3`… 取最小可用编号命名；地图视图按 `地图视图`、`地图视图 2`… 同理；
- 地图视图必须引用一个 Location Field：恰好一个时自动使用，多个时在同一展开区选择，没有 Location Field 时该类型禁用并就地说明原因；不自动创建字段；
- Map、Calendar 等 View 在满足字段条件时可以显示“可创建/推荐创建”；
- 只有用户确认后才创建真实 View；
- 不得因字段新增而静默创建 Server View；
- View 配置引用失效 Field 时进入 `configuration-required`，不得自动替换字段；
- 已创建 View 的重命名、复制、设为默认、删除与配置修复统一收在「全部视图」面板中；
- 删除 View 是破坏性操作，必须显式确认并点明 View 名称；不提供已删除 View 的恢复入口或回收站；配置修复（repair）与已删除恢复是两个概念，不得混用。

### View Tabs

- View Tabs 只负责 View 导航，不承载 Record 编辑动作；
- 顶部导航属于共享 Table/View Shell，由 View 宿主统一挂载；Grid、Map 与未来 View MUST 复用同一 Shell 实例，不在各自 Renderer 内重复渲染顶栏；
- Shell 为单行结构：Table 上下文、「全部视图」入口与 View 快捷 Tabs 位于同一行，不为 View Tabs 单独占用第二行；不再提供独立的“添加视图/管理视图”按钮；
- Table 上下文以轻量 breadcrumb 呈现 `Workspace / Base / Table`：Workspace 与 Base 两级弱化并以 `/` 分隔，Table 正常权重，以 text-only 呈现；三层统一控件高度（desktop 约 28px）、透明无阴影、带清晰 caret；三层共用原生 select 并保留可访问名称；窄 Pane 折叠为一个 compact context toggle 展开相同选择器；
- View 快捷 Tabs 横向连续排列；空间不足时横向滚动，MUST NOT 用 `+N` 折叠隐藏 View；
- 当前 View 必须有明确选中状态；
- 移动端可以使用横向滚动或 Sheet；
- View 名称可以修改，但导航、缓存和恢复必须使用稳定 View ID；
- View 类型名称遵守领域术语，不使用 Table、表格和数据表混称。

### 全部视图面板

- 「全部视图」打开锚定在其触发按钮的轻量 Popover：默认位于触发器下方约 4px 并与触发器左对齐，靠近宿主 Pane 边缘时 flip/clamp，不覆盖触发器，不锚定到 Shell 右端；
- 面板从上到下分两个区域，之间用细分隔线隔开：
  1. 所有视图区：列出当前 Table 的全部活动 View，每行为 `View icon + 名称` 左对齐，行尾一个 `...` 更多菜单；
  2. 操作功能区：“新增视图”就地展开上述类型选择器（表格视图 / 地图视图）。
- 当前 View 只用主色 icon/文字强调（`aria-current`），不使用明显背景块；整体保持低视觉重量；
- 点击 View 行主体切换 View；`...` 菜单不触发切换；
- 行内 `...` 菜单提供：重命名、复制、设为默认、删除；View 存在失效 Field 引用时额外提供“修复”；
- 重命名与复制使用行内编辑（View 名称原地变为输入框）：Enter 提交、blur 提交、Esc 取消恢复原名；保存失败保留输入并显示错误，不静默丢弃；
- 删除在行内展开确认区，明确写出 View 名称；确认后删除该 View（记录不受影响），不提供撤销/回收站；
- 视图排序（拖拽调整顺序）需要 Server/OpenAPI 的 position 支持以跨设备一致，归入 P2.0；在此之前不提供拖拽柄，也不做本地顺序持久化。

### Toolbar

Toolbar SHOULD 按以下顺序组织：

- 当前数据表和 View 上下文；
- Search、Filter、Sort 等查询操作；
- Add Record、Refresh、View 配置等动作；
- 低频动作进入 More 菜单；
- 当前激活的 Filter、Sort 和其他查询状态必须可见；
- Toolbar 是基础总行数的唯一主位置：Σ 汇总行 MUST NOT 重复基础行数（loaded/total、filtered/total 都只出现在 Toolbar），仅在选择存在时显示真正新增的选择摘要（如“已选 N 行/格”），各列聚合值与 Σ 功能本身完整保留。

### Filter 与 Sort

Filter、Sort 和 Display 面板统一采用“草稿即时校验 + 防抖自动生效”模型：

- 面板内编辑产生草稿，草稿经本地校验后按防抖自动提交生效，不提供显式“应用”按钮；
- 草稿校验不通过时，错误在对应条件行就地提示，不阻断继续编辑，也不提交非法查询；
- 校验错误区分“待填写”与“已判无效”：新建条件行的缺值/无效值提示 MUST 在该行被实际编辑（change）或焦点离开该行之后才出现；结构性错误（空组、超深、超量、失效引用）始终就地提示；
- Filter 渐进披露：首条条件以裸规则行呈现，不显示 AND/OR 分组控件；添加第二条条件（或分组）时才升级为分组结构，仅剩一条条件时收敛回裸规则；
- 规则与分组的“移除”按钮 MUST 在文本与可访问名称中注明对象（移除规则 / 移除分组）；
- 提交期间面板控件保持可用并反映 pending 状态，不得整面板锁定；
- 单字段 Sort 可以通过列菜单的升序/降序入口或 Sort 面板立即生效，不进入面板草稿；
- Filter Operator MUST 根据 Field Type 能力提供；
- Filter/Sort 生效后旧 Cursor 必须失效并从正确的起点重新查询；
- 工具栏 Filter/Sort 按钮 MUST 实时反映本地草稿中的条件数量与激活状态，不等服务端回写；
- Plugin 不得只对当前缓存页执行本地筛选或排序来伪造 Server 结果。

## 保存、加载、错误与离线状态

### 保存状态

内部 Mutation Queue 可以保留更细的状态，但用户可见状态必须是：

```text
有修改 → 保存中 → 已保存
                  ↘ 保存失败
```

View 右上角 MUST 提供 View 级聚合保存状态指示器：

| 状态 | 用户可见表现 | 是否持续 |
|---|---|---|
| Dirty | 图标 + “有修改” | 是 |
| Saving | 图标 + “保存中” | 是 |
| Saved | 图标 + “已保存” | 文字短暂显示，随后只保留图标 |
| Error | 图标 + “保存失败” | 是，提供重试 |
| Conflict | 图标 + “存在冲突” | 是，提供 Conflict UI 入口 |
| Offline readonly | 图标 + “离线，只读” | 是 |

规则：

- 内部 `queued` 和 `saving` 对外合并为“保存中”；
- 只有没有 Dirty、Queued、Saving、Error 或 Conflict 的活动变更时，才允许进入 Saved；
- “已保存”折叠为图标后仍 MUST 有 Tooltip 和可访问名称；
- 下一次修改立即恢复“有修改”；
- 保存失败和冲突不得被成功保存状态覆盖；
- 状态变化 SHOULD 使用 `aria-live="polite"`，不得依赖动画；
- 编辑器保留输入与局部校验；系统保存/失败/Conflict 由 Status/Operation Feedback 承接，不重新绘制为 Cell 装饰；
- 目标入口为 Summary → Operation Records、独立 Trash → Deleted Records，具体生命周期与 API 启用边界见下文「操作记录与已删除记录」；不另建三 Tab 的第二套模式。Grid Current 与 DOM focus 独立，不能抢回面板焦点；

### Loading

- 首次加载可以使用 Skeleton 或明显 Loading；
- 后续刷新应保留表头、Toolbar、Grid 布局和已有稳定内容；
- Grid 数据、Map 数据、Map 瓦片和 Record 保存状态必须分别表达；
- 普通查询不应使用全屏遮罩阻塞整个 View；
- 迟到响应不得覆盖当前 View、Query 或 View Revision 的结果。

### Empty 与 Error

至少区分：

- `empty`：数据表没有 Record；
- `no-match`：有 Record，但 Filter 没有匹配；
- `configuration-required`：View 配置引用失效 Field；
- `offline-empty`：离线且没有缓存；
- `authentication/permission`：认证或权限问题。

每种状态 MUST 提供对应动作，例如新建记录、清除筛选、修复 View、连接 Server 或重新认证。

错误应就近显示：

- Field 错误显示在字段附近；
- Record/Mutation 系统错误由 Status/Operation Feedback 提供可操作反馈；原编辑意图保留，Record Detail 继续使用对应字段级提示；Cell 附近只呈现输入本身的校验错误；
- 网络、认证和 Server 错误可以使用状态条或 Notice 辅助表达；
- 文案必须说明原因和下一步，技术错误码默认放在可展开诊断区域。

### Offline

- 有缓存时使用 `offline + ready + readonly`；
- 无缓存时显示明确的离线空态；
- 离线时禁止新的写操作；
- 不创建离线待提交 Mutation；
- 恢复在线后由用户主动刷新或重新执行操作；
- Offline 状态不能只通过降低透明度表达。

## Field Renderer 与 Editor

### Renderer 与 Editor 分离

同一个 Field Type MUST 在 Grid、Record Detail、Map Card、未来 Dashboard 组件中复用统一的值语义：

- Renderer 负责展示；
- Editor 负责编辑；
- Filter/Sort 负责查询；
- 三者共享 Field Type 的校验、标准化、序列化和空值规则；
- 不同 View 可以改变布局和信息密度，但不能改变值的含义。

### 空值

- Grid 中 Unset、null 和自然空值默认使用低干扰的空值标记；
- Record Detail 中应能区分“未设置”“已清空”和类型自然空值；
- Text 空字符串、MultiSelect 空数组等合法自然空值不能被误显示为网络错误；
- 空 URL 和无有效成员的 Location 不能被静默转成其他值；
- 空值标记必须有可访问解释。

### Select 与 MultiSelect

- Chip 只表示 Select/MultiSelect Option，不引入 Tag 领域对象；
- Chip 颜色来自 Server 语义色板 Token；
- Chip MUST 同时显示文字，不能只靠颜色区分；
- 已删除但仍被 Record 引用的 Option 必须显示“已删除选项”等明确状态；
- 多选内容过多时显示前几个 Chip 和 `+N`；
- Grid 中 Chip 紧凑，Detail 中可以展开完整列表；
- Option 编辑和 Record 编辑使用不同入口；
- 键盘可以进入、选择和删除 Option。

### Location

Grid：

- 优先显示 `label` 或 `address`；
- 有效坐标可以显示轻量定位图标；
- 缺少合法成对坐标时显示“未定位”；
- 坐标超出可渲染纬度时显示“不可渲染”；
- 不得伪造默认坐标。

Detail：

- 分开显示名称、地址、坐标、Provider 和 Precision；
- 有效坐标提供“在 Map 中打开”；
- 坐标支持复制；
- 所有输入方式复用同一个 Location Editor 和 Mutation/Conflict 流程。

预览：

- Windows/Linux 使用 Ctrl，macOS 使用 Cmd；
- 在坐标入口上悬停并按住修饰键，等待短暂延迟后显示临时单点 Map Preview；
- 预览可以显示地点摘要、单个 Marker、底图和 Attribution；
- 预览不得修改 Record、Map View Config 或 Default Camera；
- 预览不得执行 Marker 拖动写入；
- 预览中提供“在 Map 中打开”；
- 释放修饰键或离开预览区域后关闭，移动到预览内容时应保持可操作；
- 移动端使用点击或长按入口；
- 修饰键预览不是唯一访问方式，键盘和点击入口必须可用。

### Attachment

Grid 只显示摘要：

- 首个缩略图、文件名或附件数量；
- pending、ready、失败和失效引用状态；
- 不在 Grid 中展开大尺寸预览。

Detail/Sheet 提供：

- 按当前合同提供添加、预览、打开、下载、移除记录引用和重试；
- 文件名、大小、MIME、来源等元数据；
- Managed Attachment 与 Vault Attachment 的来源区分；
- 移除记录引用前确认；资源级删除/恢复/GC 按 [附件决策](../architecture/attachment-resource-lifecycle-decision.md) 独立处理；
- 上传状态和 Record 引用保存状态分开显示。

## Grid 交互

### Cell 状态

Grid Cell 区分 readonly、current、selected、hover、editing 和输入校验状态。DOM focus、Row Selection、Current、编辑草稿和系统写入生命周期分别维护。

- Current 是独立于 DOM focus 的持久业务位置，以最终 2px overlay 表达；选中/hover 不覆盖它。
- 编辑器有清晰边界；局部 invalid 提示只解释当前输入，保持固定行高。
- 系统 Dirty/Pending/Saved/Error/Conflict/Offline 由既有 Controller/Queue 与 Status/Operation Feedback 表达，不能回流为 Cell 的第二套保存装饰。
- 可访问的宿主 focus-visible 必须可见；不新增 Loom Focus variant。Selected 不等于 focus，也不等于 Current。

以下状态是不同概念，不得混用同一字段或同一视觉：

- Active/Selected Cell：Grid 维护的持久选中位置，与 DOM focus 无关；
- DOM Focus：浏览器 `document.activeElement`，可落在 Cell、输入框、Toolbar 或其他控件上；
- Editing：Cell 已挂载编辑器；
- Dirty/Saving/Error：该 Cell 或 Record 的写入生命周期状态。

### Persistent Active Cell

Grid MUST 维护一个独立于 DOM 焦点的持久 Active Cell：

- 打开已有数据的 Table View 时选中第一个可选择的数据 Cell，但不抢夺宿主 DOM 焦点；
- 点击其他 Cell 切换 Active Cell；鼠标移出 Grid、或 DOM 焦点转移到 Toolbar/View 控件时，不得清除 Active Cell；
- 仅当 Cell 身份失效（Record 删除、被过滤、Field 移除）时清除或重算选择；fallback 选择邻近 Cell，无邻近时选择第一个可用 Cell；
- 新增记录以当前 Active Cell 所在 Record 作为插入锚点（手动排序 View 中插入到其后一行）；
- 创建完成后 Active Cell 移动到合理的第一个可编辑 Cell；
- Active Cell 的身份按 `View ID + Record ID + Field ID` 保存，不保存在 DOM class 或节点引用上。

### Pointer 与键盘

- 单击只负责选中和聚焦；
- 双击或 Enter 进入编辑；不可编辑 Cell 上的 Enter 打开 Record Detail；
- Grid 就绪且页面焦点空闲（落在 `body`）时，自动聚焦当前 View 首个可编辑 Cell；该聚焦是软焦点：滚动锚点恢复与用户显式操作优先，重绘不得为它抢回滚动位置，用户点击或按键后提升为普通选中焦点；
- 选中后直接输入可替换原值并进入编辑；
- Enter 提交并保留当前 Cell；
- Tab 提交并移动到右侧 Cell；
- Shift+Tab 提交并移动到左侧 Cell；
- Esc 取消并恢复原值；
- 非编辑状态下方向键移动焦点；
- 编辑状态下方向键由输入控件处理；
- 输入法组合期间不得因为 Enter 或方向键误提交；
- 复杂字段进入 Popover、Detail Panel 或 Sheet；
- 有未提交草稿时关闭 Editor 不得静默丢弃。

### 稳定焦点

焦点必须绑定稳定业务身份，而不是临时 DOM 节点：

```text
Table ID + View ID + Record ID + Field ID
```

虚拟行重用、查询刷新或局部重绘后：

- 如果 Record 和 Field 仍存在，应尽量恢复焦点；
- Record 被删除或过滤掉时，焦点移动到可预测的邻近 Cell；
- Cell 状态不得只保存在 DOM class 中；
- 自动化测试必须能够观察焦点、编辑和保存状态。

## Record Detail 与 Conflict

### Record Detail

- 顶部显示 Primary Field 和 Record 操作；
- 字段按 Field 顺序展示；
- 每个字段统一显示 Label、Value、Editor、Error 和 Save State；
- 单次交互可确定完整值的 Checkbox/Select 保留既有接受即存语义；Date 遵守下文「DatePicker」的 Confirm/outside/Tab 单一接受合同，不由 change/blur 直接写入。文本、多值与复合字段保留各自保存/取消边界；失败保留输入与字段级反馈；
- 桌面端优先使用 Detail Panel；
- 移动端优先使用 Sheet；
- Grid、Map 和未来 View 点击记录时复用同一种 Detail 语义；
- 上一条、下一条、关闭、删除和恢复操作位置稳定。

### Record 导航与生命周期

- 上一条/下一条只改变当前 Record，不改变 View Config；
- 关闭 Detail 返回原来的 Grid Cell 或 Map Marker；
- 删除是软删除，需要确认或 Undo；
- 已删除 Record 可以恢复；
- 存在未提交草稿时不能直接切换 Record；
- 已提交但仍在 Saving 时可以切换，但保存必须继续由队列处理；
- 保存失败或 Conflict 时切换前必须明确处理或保留状态；
- 删除和恢复遵守普通 Mutation/Conflict 流程。

### Record 创建

- 「新增记录」是单一直接动作：点击立即在 Grid 中展开行内草稿行，不再提供二级创建菜单；
- 行内草稿入口不因 `hasMore`（存在未加载分页）而隐藏；
- 草稿行位置：手动排序 View 中跟随当前显式聚焦/选中的记录之后，其余情况（非手动序、无显式焦点、软焦点）追加到已加载记录末尾；
- 草稿激活时其后行视觉下移让位；该位移是位置预告，非已持久化顺序；
- 手动排序下创建成功后通过 `moveRecord(afterRecordId)` 持久化锚点位置；
- Enter/失焦提交草稿，Esc 取消，空草稿静默丢弃；
- 创建失败保留已输入草稿值并恢复草稿焦点，不得静默丢失用户输入；用户主动移走焦点后不抢回；
- 字段间 Enter/Tab 推进草稿编辑而不提前提交。

### Conflict Panel

- 打开后焦点进入冲突摘要；
- 可以按 Record/Field 顺序浏览冲突；
- 操作顺序为采用 Server、覆盖 Server，逐字段合并作为后续能力；
- 覆盖操作不得成为默认焦点；
- 解决成功后焦点回到原 Record/Cell；
- 关闭 Conflict Panel 不等于解决冲突；
- 一个 Record 的 Conflict 不得阻塞其他 Record。

## 响应式、主题与可访问性

### 容器响应式

响应式适配分为两类，规则不同：

**空间/布局响应（Spatial/Layout Responsiveness）**

组件与面板的布局适配 MUST 由 LoomTable 自身实际的 container/pane 可用宽度驱动。MUST NOT 用 viewport width、User Agent、设备名称或宿主环境类名（如 `is-phone`）推断一个 LoomTable View 的实际可用宽度——同一窗口宽度下，View 可能处于全宽、分栏、侧栏等不同容器。

- 宽容器：完整 Toolbar、Grid 和 Detail Panel；
- 中等容器：Toolbar 折叠，Detail Panel 可收起；
- 窄容器：详情和 Sheet 优先，Grid 减少操作；
- 移动端视口：触控和 Record Detail 优先；
- Dashboard 等未来组件必须具备确定性的网格重排规则。

**环境/交互响应（Environment/Interaction Responsiveness）**

当 UI 差异确实来自设备或交互环境（而非容器宽度）时，MAY 依据运行环境信息进行适配，例如：mobile host context、pointer/hover capability、触屏、`safe-area`、`prefers-reduced-motion`、`prefers-contrast`、print 等。典型场景：移动端专用底部操作栏、触控目标放大、Popover → Bottom Sheet、长按替代部分 hover/右键。

此条款不放宽上一类规则：环境/交互信息 MUST NOT 被用来推断 pane 可用宽度。两类响应允许组合——同一个移动端 UI 仍须根据自身容器宽度做进一步布局适配。

浮层形态的响应式决策 MUST 收敛在单一接缝：

- 桌面宽容器使用 Popover，窄布局使用 Sheet/底部抽屉；
- 判定宽度与切换逻辑由共享的单一入口决定，任何面板不得自行引入断点分支；
- 面板默认不随窗口变窄自动变形；只有显式声明响应式的面板才切换为 Sheet——在多处复用的面板（如字段设置、查询构建）不得因宿主窗口变窄而改变形态；
- 同一面板的触发控件在两种形态下保持一致，不随形态改变。

触屏输入不得以 hover 为唯一路径：右键菜单、拖拽排序等指针型能力 MUST 提供触屏等价入口（长按、显式拖拽手柄等）。

### 键盘、触控和辅助技术

- 所有可操作元素 MUST 可通过键盘到达；
- Focus Ring 不得被裁剪或与背景混淆；
- 状态不能只靠颜色、动画或位置表达；
- 表单错误必须与对应字段关联；
- 图标按钮必须有可访问名称；
- 状态变化 SHOULD 使用 polite live region；
- 触控目标不得过小；
- 移动端的返回、Esc、下拉关闭和点击外部必须遵守未保存修改规则；
- 支持 `prefers-reduced-motion`。

### 主题适配

组件测试至少覆盖以下主题变量环境与 fallback；不要求安装真实主题或执行人工设备矩阵：

- Obsidian Native Light；
- Obsidian Native Dark；
- 常见第三方 Light/Dark 主题；
- 高对比或异常颜色主题；
- 缺失非标准变量时的 fallback。

不得出现白字白底、黑字黑底、焦点不可见、错误不可见、边界消失或文字被背景吞没的问题。

## 文案、Tooltip 与快捷键

### 文案

- 所有用户可见文案 MUST 进入 i18n；
- 同一动作在 Grid、Map、Detail 和 Toolbar 中使用一致动词；
- 技术错误码默认不单独展示；
- 诊断信息可以在展开区域显示；
- “有修改”“保存中”“已保存”“保存失败”“存在冲突”“离线，只读”等状态用词必须固定。

### 快捷键

至少定义：

- Enter：进入编辑或提交；
- Esc：取消或关闭可取消编辑；
- Tab/Shift+Tab：提交并移动；
- 方向键：移动 Cell 焦点；
- Ctrl/Cmd+C、V：复制和粘贴；
- Delete/Backspace：清除当前值，遵守 Field 空值语义；
- Ctrl/Cmd + 坐标悬停：Location 预览。

快捷键不得覆盖 Obsidian 或操作系统已有快捷键。移动端不应依赖快捷键完成必要操作。

## Component Gallery 与验收

Component Gallery MUST 覆盖：

- Button、Input、Select、Popover、Sheet；
- Field Renderer 和 Field Editor；
- Grid Cell；
- Record Detail；
- Save Status；
- Conflict Panel；
- Empty、No Match、Error、Offline、Loading、Configuration Required；
- Light/Dark；
- 空值、长文本、超长文件名、长选项列表、窄容器；
- 键盘焦点、触控、reduced motion；
- “有修改 → 保存中 → 已保存/保存失败”完整序列；
- Location 有坐标、未定位、不可渲染和配置缺失；
- Attachment pending、ready、失败和失效引用。

新组件或新 View 在作为完成交付前 MUST：

- 通过对应 Component Gallery 状态检查；
- 通过 Light/Dark 和窄容器检查；
- 通过键盘、触控和辅助技术基本检查；
- 通过错误、冲突、离线和未保存修改检查；
- 在偏离 HIG 时提供书面例外说明。

## 例外与变更

- HIG 是 Plugin UI 的规范性来源；
- 组件或 View 若需要例外，必须在自己的设计文档中说明范围、原因和替代验收方式；
- 例外不得通过临时 CSS 或未记录的交互行为产生；
- Server 文档只记录数据和 API 合同，不复制本文件的完整视觉规范；
- HIG 的修改必须同步检查 Design System、Grid、Map、Client Contract 和 Component Gallery 的引用关系。


## Wave 1.5 已批准交互合同

本节定义目标交互；具体启动范围和当前能力见 [Wave 1.5 API Boundary](../wave1.5/api-boundary.md)。设计已批准不代表 Runtime QA 完成。技术所有权/资源释放见 [Editor Lifecycle](../architecture/field-editor-lifecycle.md)，视觉量值只在 DS 维护。

### Owned Overlay

每个浮层归一个稳定 owner，子菜单/值选择器登记为 owned child。inside 判定包含 trigger 与所有 owned overlay 的 composedPath；内部 pointer/focus/Tab 不产生 outside 提交。Esc 只处理最上层，取消未发草稿并在适用时回有效 trigger；外点和上下文切换不得抢回用户当前 focus。

关闭/销毁释放 listener、timer、rAF、observer、pointer capture 与子 overlay；迟到成功/错误只归原操作，不能修改新 Table/View/editor。UI 销毁可取消尚未发出的 intent，不能把已发送 Mutation 伪装为撤回或换新 ID 重试。

### Query Panels

- Filter 保留 bare-first/root group 渐进披露、typed operand、touched 校验、depth8/nodes100 和约300ms串行自动生效。rule/group 只在同 parent 内重排，保持局部 stable identity；删除、Field/operator 改变或 context 切换使旧 child picker 无效。远端 distinct search/append 单 flight、cursor 去重，clear operand 为 undefined，保留 search 与 last valid query。
- Sort 的 Add 先打开临时 Field Picker，选择 active/sortable/unused Field 后一次追加完整 Entry；最多10个去重 Field，移动保留 direction/nulls。失败草稿保留，不新增 Apply。
- Display 使用正向 visibility、density Select、任意 frozen 子集、More freeze/unfreeze，与 Header 使用同一命令。隐藏时 unfreeze，但保留 active Field 宽度；obsolete Field 才清理。重显示不自动 refreeze，至少一个 visible。Display intent 不能覆盖并发 resize 的新宽度。
- Reorder 只由明确 handle 启动，提供键盘/菜单等价入口；pointercancel 恢复原数组并释放 capture。whole-row click、checkbox、detail 和空白不启动 drag。
- Filter Date 是 query operand；可复用 Calendar body 的本地接受，保留 clear=undefined 和自动更新。不把 Record Date 的持久化/Undo/完整 Footer 协议强加给 Query。

### Choice Picker

当前 ID 选择器始终提供 search、clear 和一致 option list，不按数量阈值切成不同保存协议。仅 active ID 可新选；deleted reference 可显示/移除；unknown sentinel 不提交。search 不写入、不清已选；clear 不清 query。

Select clear 为 null，MultiSelect 为 []，Filter scalar 为 undefined。Single 保留既有消费者接受即存，Multi 保留各消费者草稿/保存边界；Create Draft 仅更新 local accepted values/touched。内部 owned focus 不触发旁路提交；失败保 draft/query。完整文字通过可访问说明/详情获得，Tag 外观按 DS。

Field create 可搜索现有10种类型，edit 中类型固定；类型转换是另一个已有/未来流程，不由 Picker 自动增加业务。standalone options order 经既有 Field CAS 保存。新三色 writer 与 inline atomic create-and-select 等待 G1/G2；不能用临时 ID 或 Field PATCH + Record 两次请求伪装原子动作。

### View 与 Inline Rename

Current View 与 Default 独立，More 命令不选择 View。Context 为 text-only 层级/caret；快捷 tabs 不用 +N 折叠。Map 0/1/N 有效 Location Field 的既有流程保留，不为了创建示例新增 Field。

Rename 保持 leading/name/trailing 槽、边界和行高稳定，输入不嵌入 button。Enter/blur 共享一次接受，IME 不提交；Esc 恢复原名。成功才结束；failure/conflict/unresolved 保输入与可修复错误。Table/edit epoch 改变后旧 completion 不关闭新编辑器。View order/生命周期 tail 等 G3，不用本地持久顺序替代 Server。

### DatePicker

Date-only 使用合法 Gregorian YYYY-MM-DD，年0000–9999，不经本地时区或 ISO timestamp 往返。null、unset/absent、空字符串分别处理；空串无效，Clear 不是 unset。低年0–99不能依赖 JS Date.UTC 的隐式1900映射。Today 只取可注入的本地系统年月日。

Day/Month/Year 三层选择，Year 每页20年，选择 Year→Month→Day。preferred day 在短月 clamp 后保留，回到足够长月份恢复；导航/焦点/建议 Today 不自动 dirty。空值打开只给建议，不默默触摸 Record 值。

| 输入 / 状态 | 接受与持久化 |
| --- | --- |
| 选择 day / 导航年月 | 只更新本地 candidate/display/preferredDay，不保存 |
| Today | 选择本地今天为 candidate；是否保存仍按接受动作 |
| Confirm | 合法时显式接受；空建议只有 Confirm 才接受 |
| Outside / 真正 Tab 离开整个 picker | 有修改且合法时接受，未修改零写；和 Confirm 同一同步 claim 的 intent/promise |
| Clear | optional 时一次 explicit null；原空无变化则零写；当前 Field 没有 required config，只有真实 consumer policy 才限制 Clear |
| Esc | 取消未发草稿、恢复 original value/presence；只消费 picker 层，不触发外层第二次 discard/close |
| Invalid / incomplete outside | 零写，保 raw draft 在原 context 可恢复；外部目标动作正常，不抢回 focus |
| failure / conflict / unknown | 保意图与输入，沿既有 Controller/Queue/Status 恢复；不显示假成功、不换 body/id 伪重试 |
| context switch / dispose | 取消未发草稿与视觉工作；已发 Mutation 仍由原 context/operation owner 处理 |

Grid、Detail 使用一个捕获原 context 的 promise-aware save owner；没有 change/blur 第二条保存旁路。Create Draft 的 Confirm/Clear 只修改本地值/touched，outer Create 才唯一持久化；内部焦点不触发 row focusout create。提交前校验/接收本地值，非法 raw 不能被旧值偷偷替代。Map Create Form 使用同一生产组件与释放路径。Filter adapter 保持 query 语义。

Calendar 使用 roving focus/native activation 和清晰 label；箭头、Home/End/PageUp/PageDown 属于当前 calendar 的局部导航，导航 focus 不选值、不提交。Tab 可以真正离开，不做非 modal trap。pane clamp/flip/低高度 Sheet、两主题/大字体/触控命中按真实宿主验证；视觉尺寸见 DS。

### 操作记录与已删除记录

Summary 打开 Operation Records，独立 neutral Trash 打开 Deleted Records；当前投影无 Actor/Profile。目标共用 header/close、body-only scroll、hasMore 时的 Load More footer，少量/空内容使用 HUG；pane clamp 与窄 Sheet 复用同一数据模型，焦点不被 Grid Current 抢回。

Operation 行为五列：修改时间、Field、Before、After、Action；value change 不额外塞 Record title/ID，lifecycle Field 使用“—”或窄布局合并短语。宽/中/窄模式按同一 VM 呈现36/56/80px行，窄 lifecycle58px。保 typed 0/false/null/unset/deleted reference，历史 label/color/type 必须来自 event-time 数据；缺失明确显示未记录，不能用当前 schema 伪造。

W15-08A 先修当前 history/recycle context、single-flight/410 与 local Undo busy/stack/metadata；真实 Deleted restore 保 revision/pending 门槛。W15-08B 的最终两入口必须等 G5 的 Server 分页前 Record category projection、metadata 与 identity；不能先丢弃已有真实功能、客户端全页后 filter 或把 local stack 改名为 Server feed。

可恢复 Action 以真实 capability/identity/availability 判定并给出不可用原因。local session Undo 与跨 session 整 Table rollback 分开；后者 Future。30d 可读日志不等于30d可恢复，cursor/receipt/history 各自过期语义分别处理。

### Future TimePicker

本节保留批准的运行行为，Time/DateTime/12h 仍 API-gated。Clock/Wheel 共用 canonical TimeDraft，mode/active part/选择本身不保存；值、paint angle、radius、selected feedback 与 view 分开。视觉参数和指针公式只在 DS 维护。

- Clock minute 支持所有0–59，nearest 每1分钟；24h 内环0°显示12，其余30°步进显示1–11；外环0°显示0，其余30°步进显示13–23。12h 的0°显示12，canonical hour 由当前 period 投影。中心 dead zone 保最后合法值，ring hysteresis 不改视觉半径。
- 点击立即更新目标 draft，paint 沿最短弧约120ms ease-out（宿主可在100–160ms调校）；delta 使用正模 mod(targetAngle−paintAngle+180,360)−180；恰180°取固定顺时针。59→00 绘制354→360，拖动用连续 unwrapped sample angle，不每帧按 canonical 最短弧追赶。
- pointerdown capture、move 直接跟随，最多每rAF一次绘制；release 最多0–80ms短收敛。小时 click/up 完成后进入 Minute，新输入取消旧 auto-advance；pointerdown 不提前切盘。cancel/lostcapture 保最后合法 draft，零保存。
- Wheel 两列 native scroll/inertia + 一个 snap owner；不叠加第二套惯性。最多3个循环投影，静止 rebase 到中间；12h 仍24个 canonical hour ID，23↔0更新 period；minute59↔0不carry小时/日期。
- scrollend feature detect，fallback 为无新输入约120ms、pointer/key释放且连续2rAF稳定；受控 Snap60–140ms，Confirm/outside settleBoth 推荐≤160ms。新输入取消旧 snap/epoch，模式切换先 settle/resolve 再取消旧工作，旧 completion 不反写 draft。
- AM/PM 整体是一个 button，一次 activation 执行 hour=(hour+12)%24，minute不变；aria-pressed 表达 PM，内部 label/indicator aria-hidden。indicator 上下移动18px约120ms ease-out，颜色同步；快速切换重定向当前 paint，旧 transitionend 只清理不保存。
- Reduced motion 直接落位，保连续输入的数值正确性；取消 gesture/timer/rAF/capture 并按原 session 处理 Clear/Esc/context。模式 target 的 keyboard 图标表示转 Wheel，clock 表示转 Clock，不增加第三种 keyboard mode 或持久化偏好。

Pointer、Touch、Wheel 各设备、0°跨越、文字遮挡、Focus、settle/中断和资源释放必须在 Plugin Runtime 验证。Figma Motion 或静态播放演示不属于实现依赖。

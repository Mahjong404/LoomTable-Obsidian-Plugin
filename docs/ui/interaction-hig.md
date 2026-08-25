# LoomTable Interaction HIG

## 目标与范围

本文档是 LoomTable Obsidian Plugin 的规范性 UI/UX 文件，定义界面、交互、状态、可访问性、主题适配和组件验收规则。

本文档适用于：

- Grid/网格视图；
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

字段语义、View 数据合同、Mutation 和错误合同以 LoomTable Server 文档和 Plugin Client Contract 为准。

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
| Grid View | 网格/网格视图 | Grid | 默认数据浏览和编辑 View |
| Map View | 地图/地图视图 | Map | Location 数据的地理展示 |
| Dashboard View | 仪表盘 | Dashboard / `dashboard` | 由统计和分析组件组成的总览 View |
| Record | 记录 | Record | 数据表中的一条数据 |
| Field | 字段 | Field | 一种值的定义 |
| Location | 地点 | Location | 可包含地址、名称和坐标的值 |
| Relation | 关联记录 | Relation | 指向其他 Record 的关系 |
| Attachment | 附件 | Attachment | 指向文件内容的引用 |

规则：

- Table 在用户界面中使用“数据表”，避免与“网格”混淆；
- 默认 View 使用“网格”，完整描述使用“网格视图”；
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
- 关闭后焦点必须返回触发控件或其稳定替代位置；
- `Esc` 必须关闭可取消的浮层；
- 有未提交草稿时，点击外部、系统返回或下拉关闭不得静默丢弃修改；
- 浮层中的 Primary、Cancel 和 Danger 操作位置应稳定。

## View Shell 与 Toolbar

### View 默认与条件创建

- 新建数据表时默认只创建一个网格视图；
- Map、Calendar 等 View 在满足字段条件时可以显示“可创建/推荐创建”；
- 只有用户确认后才创建真实 View；
- 不得因字段新增而静默创建 Server View；
- View 配置引用失效 Field 时进入 `configuration-required`，不得自动替换字段；
- 已创建 View 的删除、恢复、重命名和配置修复使用统一 View 管理入口。

### View Tabs

- View Tabs 只负责 View 导航，不承载 Record 编辑动作；
- 当前 View 必须有明确选中状态；
- 添加 View 与 View 管理入口必须可发现；
- 桌面端可以使用横向 Tabs，移动端可以使用横向滚动或 Sheet；
- View 名称可以修改，但导航、缓存和恢复必须使用稳定 View ID；
- View 类型名称遵守领域术语，不使用 Table、网格和数据表混称。

### Toolbar

Toolbar SHOULD 按以下顺序组织：

- 当前数据表和 View 上下文；
- Search、Filter、Sort 等查询操作；
- Add Record、Refresh、View 配置等动作；
- 低频动作进入 More 菜单；
- 当前激活的 Filter、Sort 和其他查询状态必须可见。

### Filter 与 Sort

Filter 和 Sort 使用不同的提交规则：

- Filter MUST 始终采用“草稿 → 应用”；
- 单字段 Sort 可以通过列标题点击或方向切换立即生效；
- 多字段 Sort 和高级 Sort MUST 采用“草稿 → 应用”；
- Filter Operator MUST 根据 Field Type 能力提供；
- Filter/Sort 应用后旧 Cursor 必须失效并从正确的起点重新查询；
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
- Cell/Record 局部状态与 View 级聚合状态必须互补。

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
- Record/Mutation 错误显示在行、Cell 或 Record Detail 附近；
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

- 添加、预览、打开、下载、删除和重试；
- 文件名、大小、MIME、来源等元数据；
- Managed Attachment 与 Vault Attachment 的来源区分；
- 删除确认或 Undo；
- 上传状态和 Record 引用保存状态分开显示。

## Grid 交互

### Cell 状态

Grid Cell 至少区分：

- `readonly`；
- `focus`；
- `selected`；
- `editing`；
- `dirty`；
- `saving`；
- `saved`；
- `error`；
- `conflict`；
- `offline`。

推荐的视觉优先级为：

1. Conflict/Error；
2. Editing；
3. Saving/Dirty；
4. Selected/Focus；
5. Hover；
6. Readonly。

Focus 必须有明确 Focus Ring，Selected 必须与 Focus 可区分，Editing 必须有清晰编辑边界，状态不能只靠颜色表达。

### Pointer 与键盘

- 单击只负责选中和聚焦；
- 双击或 Enter 进入编辑；
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

界面 SHOULD 根据可用容器宽度，而不是 User Agent 或设备名称适配：

- 宽容器：完整 Toolbar、Grid 和 Detail Panel；
- 中等容器：Toolbar 折叠，Detail Panel 可收起；
- 窄容器：详情和 Sheet 优先，Grid 减少操作；
- 移动端：触控和 Record Detail 优先；
- Dashboard 等未来组件必须具备确定性的网格重排规则。

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

至少验收：

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


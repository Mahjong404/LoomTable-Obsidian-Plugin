# LoomTable Interaction HIG 问题修复与实施顺序

> 本文档是实施与验收计划，不是规范性 HIG。规范要求见 [Interaction HIG](./interaction-hig.md)；现有阶段和范围背景见 [HIG 落地计划](./interaction-hig-rollout.md)。
>
> 本计划的当前记录以 Plugin 远端 main `622aae40af1f64331cc34e0d308f47c1422e0fc9` 为准；历史制定基线 `d3469e7e133ad4a1854833be4912de93953e8e2e` 仅保留在交付记录中。Server docs/main 保持 `ab949d59c37680d53b4109e1502f8478b24cc655`；Server runtime/API stable-support freeze 保持 `e02f055fecddc0852085dc5a71b4eb136860774a`；Plugin 使用的 OpenAPI source 保持 `ef0c6bd751642f4a604fe1bf88980f64e39dd992`。本计划不自动授权修改 Server、OpenAPI、字段值合同或数据库结构。

## 1. 目的与边界

本计划把当前 P1.5/HIG 审计发现转化为可执行的顺序，解决以下问题：

- 先闭合发布证据和真实 Obsidian 验收，再继续扩展 UI；
- 先修复所有现有界面的安全、反馈、焦点、文案和控件基础规则；
- 再建设统一 Field Renderer/Editor，作为 Grid、Detail、Map 和后续 View 的共同基础；
- 再实现 View Shell、View Tabs、Filter、Sort 和 Grid 显示控制；
- 最后单独设计 Record 的新增、删除、恢复和撤销；
- Dashboard、Relation、Formula、Lookup、Rollup 等不提前混入本计划的现有修复切片。

本计划遵守已经确定的产品边界：

- 默认只有 Grid/网格 View；
- Map/地图和其他 View 只能由用户显式创建，不静默创建；
- Filter 始终采用“草稿 → 应用”；
- 单字段简单 Sort 可以立即生效，多字段和高级 Sort 采用“草稿 → 应用”；
- Mutation Queue 内部可以保留 queued，用户界面只显示“有修改 → 保存中 → 已保存”或“保存失败”；
- 不增加未定义的 Tag 字段或属性；
- 自定义数据工作台保持 Obsidian Native 风格，并通过 \`--loom-*\` 语义 Token 适配其他主题。

## 2. 当前状态判断

当前代码切片已经具备：

- 基础 \`--loom-*\` 主题 Token、CSS 命名空间和 reduced-motion 规则；
- 原生 Button、Select、Input 的基础语义；
- Grid Cell 编辑、Mutation Queue、冲突恢复；
- Location 编辑、Map 数据刷新和部分键盘可访问性；
- Save Status 的 WPS 风格显示；

截至当前远端 Plugin main `622aae40af1f64331cc34e0d308f47c1422e0fc9`，已交付切片应按以下范围解释：

- **S0**：PR #63–#67 的审计、构建 provenance 和只读 smoke 证据已归档；Grid/Detail/Map 的历史或 runtime-equivalent 观察有明确边界，Location 写入、故障注入、完整键盘、浅色/窄布局等仍保留 residual unverified。
- **S1**：S1-A/B/C/D 的运行时切片由 PR #68/#70/#72/#74 交付，配套文档由 PR #69/#71/#73/#75 交付；共享文案、控件几何、危险确认、异步错误动作、Grid/Detail/Location seam 和 Map 可访问性已发布，但完整真实桌面门禁仍未闭合。
- **S2**：S2-A/A2/B1/B2 的运行时切片由 PR #77/#79/#81/#83 交付，配套文档由 PR #78/#80/#82/#84 交付；Grid/Detail/Location/Map/Settings 的自动化与契约门禁已记录，但 current-main 真实 Obsidian 最终门禁仍待受控环境验证。
- 中英文消息目录及部分 Map 文案测试。

但不能把当前状态视为“HIG 全部满足”，原因是：

- 真实 Obsidian smoke 尚未完整完成；
- HIG Audit 文档中的当前 main 基线落后于实际 main；
- 字段 Renderer/Editor 已通过 S3-A 建立共享基础，S3-B 已交付 Select/MultiSelect Chip/选项语义；S3-C 第一切片已交付结构化 Attachment，S3-C2 已交付 Detail Download host wiring；
- Attachment 的 add/upload/open/preview/delete/retry 与 Record attachment-reference 生命周期仍未实现；
- 危险操作的确认/撤销规则不一致；
- Button 尺寸、危险层级和 Select 视觉契约不完整；
- Grid/Detail/Map 的部分焦点、错误、空状态和重复操作行为仍需闭合；
- 当前没有 Record Create/Delete/Restore UI；
- rollout 中的 Table Shell、View Tabs、Filter、Sort 和 Grid 显示控制尚未成为可操作 UI。

## 3. 优先级和阶段分组

这里的阶段属于实施计划，不属于 HIG 规范：

| 顺序 | 实施组 | 目标 | 建议阶段 |
| --- | --- | --- | --- |
| S0 | 基线与验收证据 | 对齐 main、CI、审计和真实 Obsidian 验收 | P1.5 收口门禁 |
| S1 | 共享 HIG 基础 | 统一文案、控件几何、危险操作、异步反馈、焦点和状态规则 | P1.5 收口门禁 |
| S2 | 现有流程修复 | 修复当前 Grid、Detail、Map、Settings 的可用性和安全行为 | P1.5 收口门禁 |
| S3 | Field Renderer/Editor | 统一当前字段的显示、空值、Chip、Attachment 和编辑语义 | 下一 UI 里程碑 |
| S4 | View Shell 与 Grid UX | View Tabs、View 管理、Filter、Sort、列显示和行显示控制 | 下一 UI 里程碑 |
| S5 | Map/Location 完整体验 | 真正的 Map 预览、条件化打开、Cluster 记录和地图错误操作 | 下一 UI 里程碑 |
| S6 | Record Lifecycle | 新增、删除、恢复、撤销和权限失败恢复 | 独立生命周期阶段 |
| S7 | 后续字段、View 与 Dashboard | 扩展字段/View；HIG 稳定后单独设计 Dashboard | 后续阶段 |

现有 rollout 中列出的 Field Renderer、Table Shell、View Tabs、Filter、Sort 等内容仍然是未完成项。为了不把所有内容重新塞入已收口的 P1.5，S3～S5先作为下一 UI 里程碑跟踪；如果产品仍要求保留“P1.5”标签，应称为“P1.5 follow-up”，不得把它们误标为已完成。

## 4. 按顺序执行的修复方案

### S0：基线、范围和验收证据

**问题**

当前审计文档记录的 main SHA 与实际远端 main 不一致；自动化测试通过也不能替代真实 Obsidian 窗口验收。

**方案**

1. 将 HIG Audit 的当前检查点绑定到实际 Plugin main SHA。
2. 明确每条结论对应的 PR、CI、main SHA 和 Server/OpenAPI SHA。
3. 执行只读真实 smoke：
   - Grid、Detail、Map 导航；
   - Location 设置、清除、取消设置；
   - Save Status 状态变化；
   - Conflict、Authentication、Forbidden、Offline 状态；
   - Map Marker、Cluster、Provider 和瓦片错误；
   - 浅色、深色和窄容器布局。
4. 若桌面审批或环境导致 smoke 无法执行，记录为“未验收”，不得用 jsdom 结果替代。
5. 只在 S0 完成后开始新的 UI 行为扩展。

**完成门禁**

- 审计文档不再引用错误的当前 main；
- smoke 结果可追溯到具体 main；
- 未通过或未执行的项目有明确状态；
- 不改变 Server、OpenAPI 或运行时代码。

### S1：共享 HIG 基础和安全交互

**问题**

当前界面存在未翻译的字段校验文案、Button 尺寸未约束、危险按钮层级不稳定、异步操作可能重复触发、焦点和状态处理缺少统一约束。

**方案**

1. **文案**
   - 所有用户可见的字段校验、状态和操作结果通过 Translator；
   - 技术诊断保留在显式 Details 中；
   - 统一 Grid、Detail、Map、Settings 的中英文术语；
   - 不把 Server、Grid 等内部词直接暴露在不必要的普通用户文案中。

2. **控件几何**
   - 保留 \`radius-sm\` 和 \`radius-md\` 两级圆角，不强行让所有元素使用同一个圆角；
   - 为 Loom Button 建立明确的最小高度、水平/垂直内边距、焦点环和禁用状态规则；
   - 对原生 Select/Input 保留原生语义，同时定义一致的交互尺寸和焦点表现；
   - 危险操作使用明确的语义样式，不依赖未定义的宿主全局 \`mod-warning\`；
   - Map 的缩放控件也必须满足可操作尺寸；
   - 不使用全局 \`button\`、\`input\` 规则，不破坏 Obsidian 主题。

3. **危险操作**
   - Clear、Unset、Overwrite、删除 Profile/Provider 统一使用确认或可恢复撤销；
   - 二次确认必须说明对象、后果和可选动作；
   - 取消确认时不得改变数据；
   - 不能把颜色警告单独作为危险提示。

4. **异步与保存反馈**
   - 统一防止重复提交；
   - 操作进行中显示明确的 Saving/处理中状态并禁用会产生重复请求的入口；
   - 继续保持外部 Save Status：有修改 → 保存中 → 已保存/保存失败；
   - queued 仅保留为内部状态；
   - 失败、冲突和权限暂停不得误报为 Saved。

5. **焦点和错误**
   - 所有替换 DOM 的编辑器规定成功、失败、取消后的焦点目标；
   - 错误必须关联输入控件或操作区域；
   - Empty、No Match、Offline、Authentication、Forbidden、Network、Server Error 分别提供可理解的下一步动作。

**完成门禁**

- 现有 UI 不再产生未翻译的普通错误文案；
- 所有危险操作均有确认或撤销；
- Button、Select、Input 在 Light/Dark/窄容器下有稳定焦点和操作尺寸；
- 关键异步动作不会重复提交；
- 相关 DOM/键盘/文案测试通过。

### S2：现有 Grid、Detail、Map、Settings 流程修复

**问题**

当前实现已有主要操作，但部分行为不够直观或不安全。

**方案**

1. **Grid 编辑**
   - 明确 Enter、Tab、Shift+Tab、Escape 和点击其他 Cell 的提交/取消规则；
   - 编辑失败时保留输入意图并把焦点放回编辑器；
   - 虚拟滚动、分页和刷新后，按 Table/View/Record/Field 稳定身份恢复焦点；
   - Grid 的错误状态提供 Retry 或明确的设置/权限入口；
   - 保留当前乐观更新、Revision 和 Conflict 合同。

2. **Record Detail**
   - 保留打开时焦点、关闭后返回焦点；
   - 成功保存后将焦点放到更新后的字段或明确的操作入口；
   - Location 草稿在取消、关闭和切换前必须经过 dirty guard；
   - Conflict 区域获得焦点后，完成操作返回 Detail 的稳定位置；
   - Overwrite 与 Discard All 的确认策略保持一致。

3. **Location**
   - Clear/Unset 要显示明确的破坏性后果；
   - 没有匹配 Map View 时，不显示无效的“在 Map 中打开”，也不静默创建 View；
   - 如果提供创建入口，必须是用户显式触发的 View 创建流程；
   - 有效坐标、未定位、不可渲染和已清除状态要有不同显示。

4. **Map**
   - 数据状态与瓦片状态继续独立；
   - Authentication、Forbidden、Provider 配置缺失和瓦片错误提供对应动作；
   - Marker/Cluster 保留键盘操作、名称和焦点反馈；
   - 不把原始 JSON 作为面向用户的主要记录展示。

5. **Settings**
   - 保留 Obsidian Setting、SecretComponent 和原生控件；
   - 删除 Connection Profile 和自定义 Provider 必须确认；
   - 连接测试、保存失败和 Provider 配置错误提供稳定文案和有限诊断。

**完成门禁**

- 当前已存在的 Grid、Detail、Map、Settings 关键路径可以通过真实窗口操作；
- 不引入新的字段类型、View 类型或 Server API；
- 相关操作的确认、取消、错误和焦点测试通过。

### S3：统一 Field Renderer/Editor

**问题**

Grid、Detail 和编辑器各自处理字段值，导致空值、Select/MultiSelect、Attachment 和 Location 的显示不一致。

**方案**

1. 建立以当前字段合同为基础的 Field Capability Matrix 和 Field Renderer/Editor Registry。
2. 先覆盖已有字段：
   - Text；
   - Long Text；
   - Number；
   - Checkbox；
   - Date；
   - URL；
   - Select；
   - MultiSelect；
   - Location；
   - Attachment。
3. 统一定义：
   - \`undefined\`、\`null\` 和合法值的显示；
   - Grid、Detail、Map Cluster 中的相同展示语义；
   - 无障碍名称和空值朗读；
   - 只读 Renderer、编辑器和错误展示。
4. Select 使用 option name 和合法的 deleted option 表示；不得只显示 ID。
5. MultiSelect 使用 Chip Renderer；编辑器使用可选择的选项交互，不退化为手写逗号字符串。
6. Attachment 至少提供结构化文件名/类型/大小展示和明确的后续动作；上传、下载、预览按已批准能力实现。
7. URL 使用可识别的链接行为，但不得绕过安全协议限制。
8. 不增加 Tag 字段，不把未批准字段混入 Registry。

**完成门禁**

- 同一字段在 Grid、Detail、Map Cluster 中语义一致；
- Select/MultiSelect 不再显示原始 ID 或 JSON；
- 空值显示和朗读一致；
- Attachment 不再以原始 JSON 作为主要 UI；
- Registry、Renderer、Editor 有单元测试和 DOM/无障碍测试。

### S4：View Shell 与 Grid UX

**问题**

当前导航主要依赖 Workspace/Base/Table/View 的级联 Select，缺少 View Tabs、View 管理以及 Grid 的 Filter/Sort/显示控制。

**方案**

1. 以 Table Shell 作为稳定外壳，明确当前 Workspace、Base、Table 和 View。
2. 使用 View Tabs 表达用户已经存在的 View；不要把所有 View 管理操作塞入级联下拉框。
3. 默认只展示 Grid/网格 View；Map、Calendar、Timeline 等只有在用户显式创建后才出现。
4. 如果字段满足 Map 前置条件，只能提供创建建议，不自动创建。
5. Grid 显示控制包括：
   - Hide/Show；
   - Width；
   - Order；
   - Frozen；
   - Row Height。
6. Filter：
   - 编辑期间只修改草稿；
   - 点击应用后才改变 Query；
   - 取消或关闭不改变当前结果；
   - 无匹配状态提供清除或返回编辑入口。
7. Sort：
   - 单字段点击列标题或改变方向立即生效；
   - 多字段和高级 Sort 使用草稿 → 应用；
   - 明确 Sort 的当前顺序、方向和取消方式。
8. 所有 Query 继续复用已发布的 \`query\`、cursor、filter、sort、projection 和 changeCursor 合同，不使用仅存在于客户端缓存的事实。

**完成门禁**

- View 切换、创建建议、Filter、Sort 和 Grid 显示控制可被键盘和鼠标理解；
- Filter/Sort 的立即生效与草稿应用规则符合 HIG；
- Query、分页、刷新和焦点恢复测试通过；
- 不改变 Server/OpenAPI 合同。

### S5：Map/Location 完整体验

**问题**

当前 Location 已有“在 Map 中打开”和 Ctrl/Cmd 预览入口，但 Ctrl 预览只是文本提示，Cluster 仍显示原始 JSON。

**方案**

1. 有效坐标只在存在匹配 Map View 时显示“在 Map 中打开”；没有匹配 View 时显示清晰的不可用原因或显式创建入口。
2. Ctrl/Cmd 预览应调用真正的 Map 预览能力，显示指定坐标附近的 Map 状态，而不是仅追加一段坐标文本。
3. 坐标位置本身应成为可理解的预览目标，单独按钮作为键盘和无障碍后备入口。
4. 预览应支持：
   - Ctrl/Cmd 按住后的延迟触发；
   - 鼠标离开后的清理；
   - Enter/Space 或明确按钮触发；
   - Offline、瓦片错误、不可渲染坐标的清晰状态。
5. Cluster Records 复用 Field Renderer：
   - 显示结构化字段；
   - 可选择单条记录；
   - 可进入 Record Detail；
   - 支持分页和无障碍列表语义；
   - 不直接把 JSON 作为主要展示。
6. 保留 Map View 非默认、用户显式创建和 Provider 配置边界。

**完成门禁**

- Ctrl/Cmd 预览在真实 Obsidian 中是真正 Map 预览；
- 没有 Map View 时不会出现无动作按钮；
- Cluster 记录可以理解、选择并打开 Detail；
- Map 状态、焦点和 Provider 操作通过真实 smoke。

### S6：Record Lifecycle

**问题**

当前 Client Contract 有 Create/Delete/Restore 命令，但 Plugin UI 只支持更新已有 Record 的字段。

**方案**

1. 单独设计 Record Lifecycle，不和字段编辑混为一个切片。
2. 定义：
   - 新增入口、默认值和必填字段；
   - 删除前确认；
   - 删除后的可恢复窗口或 Restore 入口；
   - 批量删除是否支持；
   - 权限、网络、冲突和重复请求失败；
   - 删除期间 Filter/Sort/View 的结果变化；
   - 操作完成后的焦点和选中状态。
3. 复用已有 Mutation Queue、Revision、Conflict 和错误合同。
4. 只有在确认 Server/OpenAPI 存在最小已证实缺口时，才另行启动 Server/API 设计；不能为方便 UI 先猜新合同。
5. 删除记录必须提供清晰的对象范围，不能以隐藏的图标操作代替确认。

**完成门禁**

- Create/Delete/Restore 的产品行为、权限和恢复路径先形成设计记录；
- Grid、Detail、Map 的入口和结果一致；
- Mutation、Conflict、Offline、Retry、Restore 测试通过；
- 通过真实 Obsidian 关键路径验收。

### S7：后续字段、View 与 Dashboard

这一组在 S0～S6 的基础和 HIG 验收稳定后再执行：

- DateTime、Rating、Relation、Formula、Lookup、Rollup；
- Created Time、Last Modified Time、Auto Number 等 System Field；
- Calendar、Timeline、Gallery 等满足前置条件的 View；
- Dashboard/仪表盘的独立设计和实现。

Dashboard 不因本计划自动加入 Grid，也不在 HIG 中提前写入完整组件规范。它必须另行解决组件字段前置条件、聚合数据、Filter、错误/空态、布局约束和结果可追溯性。

## 5. 每个实施组的统一工作流

每个组都按以下顺序执行，不跨越未完成的前置组：

1. 对照本计划、HIG、rollout、Grid/Map spec 和 Client Contract，锁定最小范围。
2. 只修改所属仓库和所属文件范围；不顺手重构无关代码。
3. 先补针对性测试，再实现最小行为。
4. 运行类型检查、测试、生产构建和 OpenAPI drift 检查。
5. 完成 Component Gallery 或等价 DOM/无障碍状态检查。
6. 完成真实 Obsidian 关键路径 smoke；无法执行时标记未验收。
7. 通过 GitHub PR、CI、合并 main SHA 建立可追溯证据。
8. 同步统筹、Plugin 和 Server session 的当前阶段、阻塞点、合同和下一目标。
9. 前一组未通过门禁时，不启动后一组的实现。

## 6. 当前下一步（截至 Plugin main `622aae40af1f64331cc34e0d308f47c1422e0fc9`）

S0、S1、S2、S3-A、S3-B、S3-C 第一代码切片、S3-C2 Download host wiring、S3-C3-A/B/C1/C2/C3/C4 以及 S3-D Date renderer parity 均有可追溯的自动化和远端 CI 证据；这些证据不能替代完整 current-main Obsidian 桌面验收。Server docs/main 仍为 `ab949d59c37680d53b4109e1502f8478b24cc655`，runtime/API stable-support freeze 为 `e02f055fecddc0852085dc5a71b4eb136860774a`，OpenAPI source 为 `ef0c6bd751642f4a604fe1bf88980f64e39dd992`。

S3-C3-C3 已完成设计收口但未实现资源级功能：Attachment Resource、AttachmentRef、Detach、Resource Delete、Restore、GC 的术语与安全边界已记录；当前只支持 Record Detach 和受限 Retry，不调用资源级 `deleteAttachment`。在引用影响/所有权/共享关系、生命周期与 expectedRevision、幂等审计、保留期/备份和清理失败重试合同发布前，不启动资源级实现。

当前仍需受控 current-main Obsidian smoke 复验 Grid、Detail、Location、Map、Settings、焦点/键盘、主题/窄布局及 Attachment 生命周期；自动化 DOM/controller、构建和合同检查只能作为支持证据。当前十种已批准字段的 renderer/editor capability audit 没有发现另一个可直接实现的 scalar gap；Date renderer 已通过 S3-D 与既有 editor/Server Gregorian 校验对齐。下一阶段只可在上述合同明确后继续 Attachment 资源生命周期评估；S4/S5/S6、新字段、View、CRUD、Filter/Sort、Dashboard 均未开始。本计划不宣称整个 S3 或 P1.5 完成。
## S3-A 当前实施记录（2026-08-31）

S3-A 以 Plugin main `3006c6217ef7e764ccc6c54b2a1c4d826b0a7eaf` 为基线，经 PR #86（head `400cff073958bc51c61ec34b0a320c6a1d5adb8a`）合并至 `81f616a43784b55643a413a02d7da70def225aac`。本片建立 `src/ui/field-renderer-registry.ts` 共享 Registry/Capability seam，并让 Grid、Record Detail、Map cluster 使用同一套翻译渲染语义，覆盖既有字段类型与 undefined/null/自然空值、Location 状态、结构化 Attachment 展示。MultiSelect 的 Chip/选项交互不在本片，S3-B 已在后续代码切片交付；S3-C 尚未开始。

自动化证据为 clean staging 的 `pnpm install --frozen-lockfile` 与 `pnpm check`：39 个测试文件、348 个测试通过，OpenAPI drift 与 production build 通过；lint 无 error，仅保留既有 warning。当前 main 构建对应的真实 Obsidian smoke 未在本片执行，继续标记为 UNVERIFIED；不得用 jsdom/CI 替代。Server/API/OpenAPI、offline 只读语义和 mutation/Conflict/revision/changeCursor 合同未修改。


## S3-B 当前实施记录（2026-08-31）

S3-B 以 Plugin main `23e94b749841a7ba9ec0e65f30a7bd0ad1765bf2` 为代码基线，通过 PR #88（head `071eacd37e8f611ec7d927a2ef4569da50862c60`）交付，squash merge/main 为 `ac8313edfb24c3fd972b25fc1faa2ad91b2dc313`。PR CI run `33391496749` 与 main push CI run `33391623666` 均成功。

本片只在既有 Field Renderer/Editor registry seam 上实现 Select/MultiSelect：Grid、Record Detail、Map Cluster 共用 option name、Deleted option、Unset/Cleared、自然空值和 invalid 语义；MultiSelect 使用结构化可访问 Chip DOM；编辑使用原生 Select/multiple-select，保留已选 deleted option，并以安全 unavailable 状态呈现 unknown option。既有 set/unset 归一化、expectedRevision、clientMutationId、Mutation Queue、Conflict/revision/changeCursor、offline read-only 和 Server/API/OpenAPI 合同未改变。

自动化证据：完整 `pnpm.cmd check` 通过，包含 39 个测试文件 / 355 个测试、format、lint（既有 warnings）、typecheck、OpenAPI drift 和 production build；registry、Grid、Detail、Map、样式和 i18n 回归覆盖已发布行为。真实 Obsidian smoke 未在本片执行，继续标记为 `unverified`，不能由 jsdom/CI 替代。

S3-B 已交付，但整个 S3 未完成。下一项是 S3-C Attachment 交互/管理；本计划不在本片宣称 S3 完成，也不开始 S4/S5/S6、新字段、View、CRUD、Tag、Dashboard 或 Server/API/OpenAPI 行为。


## S3-C 第一代码切片（2026-08-31）

本片从 S3-B 交付后的 Plugin main `11e102bdf099e51c1f7d75e6f28381b56a7d26c3` 开始，通过代码 PR #90 交付：head `3c5c6faefc3574aa1a92ab7a3fa3568c995b2a48`，squash merge/main `6022a7b4b887a38251977b9fe1054b6eeea04b38`。PR CI run `33394735067` / job `99496442039` 与 main push CI run `33394847118` / job `99496806710` 均成功。

本片在既有 Field Renderer/Registry seam 上交付共享结构化 Attachment 展示：统一 `undefined`/缺失、`null`、空数组语义；以已发布 `AttachmentRef` 的 `id`、`source`、`filename` 为必需身份，以 MIME/size 等作为可选元数据；以 `ready`、`pending`、`stale`、`invalid`、`unknown` 表达安全展示状态。Grid 使用紧凑摘要，Record Detail 使用结构化 cards，Map cluster 使用共享的非交互摘要；typed `onAttachmentDownload` 仅在 host callback 存在时出现。i18n、ARIA、非颜色状态和 CSS namespace 回归已纳入代码 PR。

本片不接入真实 LoomTableView/Obsidian host 的 download/open/preview；不实现 add/upload/delete/retry，因为这些动作需要安全的文件 picker/save/open 流程以及明确的 Record attachment-reference 更新路径。不得把 callback seam 当成真实动作完成，也不得由本片新增 API 或改变 offline、Mutation、Conflict、revision、changeCursor 合同。当前 main 的真实 Obsidian smoke 仍为 `unverified`。

自动化证据：完整 `pnpm check` 通过，包含 format、lint（既有 warnings）、typecheck、39 个测试文件 / 359 个测试、OpenAPI drift 和 production build；代码 PR #90 与 main push CI 均成功。S3-C 仍未完成，后续只可在上述 host/引用合同明确后分片处理动作管理。


## S3-C2 当前实施记录（2026-08-31）

本片从 connector-核验的 Plugin main `c2937ed5370ceb983bc63eec4a927e3ca0391099` 开始，通过代码 PR #92 交付：head `d5f2f1f0412d1decfc793a2810e6e8c6fef16d17`，squash merge/main `195b7cf372a3f760f11e96162cf3e8f60f5dc41c`。PR 首轮 CI [33399275191](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33399275191) 仅因 `format:check` 失败；修正 connector 提交内容的尾换行后，最终 PR CI [33399637393](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33399637393) / job `99512497477` 与 main push CI [33399782204](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33399782204) / job `99512976540` 均成功。

本片把现有 typed `onAttachmentDownload` 从 LoomTableView 的 Grid Detail 与 Map selected-record Detail 接到既有 `downloadAttachmentContent`。ready Attachment 才显示 Detail Download；Grid/Map compact 保持非交互。安全 host helper 使用 Blob/object URL、安全 basename 与 `attachment` 回退名，触发一次下载并在 `finally` 回收 URL；不自动写入 Vault，不把 response/ID/异常详情作为普通文案。offline 时显示可理解的禁用状态且不发起无缓存请求。

本片保留现有 action 防重复、`aria-busy`、失败翻译、焦点与 en/zh-CN 语义测试；完整 `pnpm.cmd check` 通过（40 个测试文件 / 366 个测试、format、lint 既有 warnings、typecheck、OpenAPI drift、production build）。真实 current-main Obsidian smoke 的一次恢复捕获仍为黑屏且无 accessibility tree，故标记为 `UNVERIFIED`，不能由 jsdom/CI 替代。无 Server/API/OpenAPI/offline/Mutation/Conflict/revision/changeCursor 合同改动。

S3-C3 尚未开始。后续需分别定义并安全接入 add/upload/open/preview/delete/retry 与 Record attachment-reference lifecycle；在安全文件 picker/save/open 及 published reference contract 明确前，不显示假动作或猜测新的 API。


## S3-C3-A 当前实施记录（2026-08-31）

本片从 connector-核验的 Plugin main `0e32a65e41175afda1f5799752e157fa92e94b6b` 开始，通过代码 PR #94 交付：head `ff08a264499679b165c4ee7c522c252091f4ec41`，squash merge/main `9b7d3e574f347a77cee73182e6bf8659d4eb39c8`。PR CI run `33404480220` / job `99528524231` 与 main push CI run `33404672931` / job `99529167457` 均成功。

本片只在 Record Detail（Grid 打开的 Detail 与 Map selected-record Detail）建立 typed `onAttachmentOpen` / `onAttachmentPreview` 只读 callback seam：ready 且具备必需身份、对应 host callback 存在时才显示 action；pending、stale、invalid、unknown 以及缺少 callback 时不显示假 action。Grid/Map compact Attachment 摘要保持 non-interactive；offline 状态显示可理解的禁用说明，并保留 ARIA/live、焦点、重复触发保护、失败状态与 en/zh-CN 回归。

本片是 seam only，不是实际 LoomTableView/Obsidian host Open/Preview wiring；不添加 `window.open`、路径猜测、Vault 自动写入、隐式覆盖、资源回收或新的 API。Add/Upload、Record attachment-reference lifecycle、Delete、Retry 以及真实 host Open/Preview 尚未实现，S3-C3-B 与 S3-C3-C 均尚未开始，不能据此宣称整个 S3 或 P1.5 完成。

自动化证据：PR #94 与 main push CI 均运行并通过完整 `pnpm check`；DOM/controller/i18n/ARIA 测试提供 seam 证据。current-main 真实 Obsidian smoke 仍为 `UNVERIFIED`，不能由 jsdom/CI 替代；没有用户数据、凭据、Provider/Settings、Server/API/OpenAPI 或 offline/mutation/Conflict/revision/changeCursor 语义变更。

S3-C3-B 尚未开始：Add/Upload 与 Record attachment-reference lifecycle；S3-C3-C 尚未开始：Delete、Retry 与 resource lifecycle。后续必须先明确安全的 host file picker/save/open 与 published reference contract，再分别实现，不显示假动作或猜测新的 API。

## S3-C3-B 实施记录：Attachment Add/Upload lifecycle（2026-08-31）

S3-C3-B 从 connector-核验的 Plugin main `e2beb521225d046386b30a89a4c06132c8f520e9` 开始，通过代码 PR #96 交付：head `644b25b9f1a14267859f656004fa0e20aada7bef`，squash merge/main `49ce233d48763c6a72c47704a8ca4b4abe416da1`。PR CI run `33410607549` / job `99548938858` 与 main push CI run `33410782178` / job `99549515642` 均成功，并运行仓库 `pnpm check`。

本片消费已发布的 `POST /v1/attachments/init`、Managed 内容 `PUT /v1/attachments/{attachmentId}/content` 与既有 `records/mutate` 合同：Record Detail（Grid 打开与 Map selected-record）提供 Add；取消文件选择零副作用；在线流程为 initialize/pending、upload/ready，再通过现有 Grid controller 的 Mutation Queue 写回完整 AttachmentRef 列表。返回的完整 Record 用于 authoritative Detail/Map selected-record 更新，不猜 revision，不覆盖其他字段。

本片保持离线只读：offline 时 Add 为禁用且有翻译说明，不打开 picker、不发起请求、不创建离线 Mutation。上传状态、确定性错误分流、重复提交保护、ARIA/live、焦点、i18n 与跨 View 回写有代码回归；不写 Vault、不暴露 raw response/ID/path/credential/stack。

边界：本片不实现 S3-C3-C 的 Delete、Retry 与 resource lifecycle，不新增 Open/Preview 行为，不改变 Attachment wire、Mutation/Conflict/revision/changeCursor、Server/API/OpenAPI 合同；当前 main 的真实 Obsidian desktop smoke 未执行，继续标记 `UNVERIFIED`。

S3-C3-B 已交付，整个 S3-C3/S3 仍未完成。下一项 S3-C3-C 为 Delete/Retry/resource lifecycle 及其安全引用生命周期；开始前仍需保持现有 published contract、HIG、离线只读和数据/凭据边界。

## S3-C3-C1 实施记录：Attachment host Open/Preview（2026-09-01）

本片从 connector 核验的 Plugin main `9cfadd2e8ea90a1ede24421bb445bf70588e35ca` 开始，通过代码 PR #98 交付：最终 head `20f458f773dd4409db83f1dbcc233a8d563b355c`，squash merge/main `7b3b7af2835d9f0b6ec628c6238b40b98f1ce7ca`；PR CI run `33489587486` / job `99796851570` 与 main push CI run `33489723935` / job `99798092025` 均成功，并运行完整 `pnpm check`。

本片接入真实 typed host 行为：managed ready attachment 通过既有 content GET 下载 bytes，并在 Plugin-owned sandboxed read-only preview surface 中预览；Vault ready attachment 只有明确、安全相对 `vaultPath` 才通过 Obsidian vault/workspace API Open。来源、ready、identity、callback 不满足时保持 actionless；offline disabled 且不发请求；Grid/Map compact 保持 non-interactive。没有路径猜测、`window.open`、Vault 写入、token/ID/raw response 泄露或新的 API/OpenAPI 行为。

本片自动化覆盖 object URL cleanup、preview dialog 的 ARIA/键盘/焦点、失败/离线/无 callback/无效来源、重复触发及 Grid/Map compact 边界；但 current-main 真实 Obsidian smoke 仍为 `UNVERIFIED`，窗口黑屏且 accessibility tree 为空，不能以 DOM/CI 替代桌面验收。

S3-C3-C1 不包含 Add/Upload、Record attachment-reference mutation、Delete、Retry 或 resource lifecycle；前序 Add/Upload 交付保持不变。后续 S3-C3-C2（Delete、Retry、resource lifecycle 与安全引用生命周期）尚未开始；不得据此宣称整个 S3 或 P1.5 完成。Server runtime/API stable contract `e02f055fecddc0852085dc5a71b4eb136860774a`、OpenAPI source `ef0c6bd751642f4a604fe1bf88980f64e39dd992` 冻结不变。

## S3-C3-C2 实施记录：Attachment Detach/Retry/resource lifecycle safety（2026-09-01）

本片从 connector-核验的 Plugin main `815c4b0e8c15ba7a87b94a39570b2fb993534205` 开始，通过代码 PR #100 交付：最终 head `634862e8e1aa7149cf508a27ab05976e7c7f799d`，squash merge/main `748775a31e431f8e1a04e6aebf7921a41d147b98`。PR CI run `33496456430` / job `99819670992` 与 main push CI run `33496634082` / job `99820234025` 均成功，完整 `pnpm check` 通过。

本片只在 Record Detail 提供已确认的 Detach：从当前 Record 的 Attachment Field 移除一个 AttachmentRef，保留同数组其他引用；移除最后一个引用时使用 `set: []`。Detach 不等于资源级 Delete，不调用 `deleteAttachment`，不删除 Managed 资源或 Vault 原文件，不提供物理清理、Undo 或 Restore。Grid/Map compact 摘要保持非交互。

Retry 只允许用户明确触发当前失败的 Add/Upload/关联状态：同一 Add 意图复用 initialize 的幂等键和相同 metadata body；upload PUT 不自动重试；重试前先读取 Attachment，ready 跳过 PUT，pending 复用同一 ID 和 bytes，404/终态/未知状态不盲传、不创建替代资源。Record reference mutation 结果不确定时先 getRecord readback，避免重复引用，并在 revision 改变时进入现有 Conflict。

离线保持只读，Detach/Add/Upload/Record Save/Retry 不发请求、不创建离线 Mutation。确认、取消、错误摘要、aria-live、焦点和 i18n 回归保持；失败、取消、Detail 销毁或迟到响应不写入 pending 引用，也不承诺资源清理。

本片不实现资源级 delete/cleanup、反向引用/孤儿处理、Undo/Restore；当前 published contract 没有支持这些操作的计数、查询、清理或恢复接口。真实 current-main Obsidian smoke 仍标记 `UNVERIFIED`，不得以 jsdom/CI 替代。S3-C3-C3 尚未开始，整个 S3/P1.5 不能据此宣布完成。

## S3-C3-C3 实施记录：Attachment resource lifecycle decision（2026-09-01）

本片为 docs-only 设计收口，基于 Plugin main `4d6f79781ad0da5a679c8e76a737f74724302f8a`。正式决策记录见 [Attachment resource lifecycle decision](../design/attachment-resource-lifecycle-decision.md)。

术语与边界已固定：Attachment Resource 是资源对象；AttachmentRef 是 Record Attachment Field 中的引用；Detach 只通过 `records/mutate` 移除当前 Record 的引用，最后一项使用 `set: []`；Resource Delete 是独立的资源软删除；Restore 与 GC/物理清理没有当前已发布合同。当前 Plugin 不调用资源级 Delete，不实现 Restore、Undo、孤儿恢复/清理或 GC。

未来最小合同必须覆盖引用影响/反向引用或原子前置条件、所有权/共享关系、软删/恢复状态与 expectedRevision、幂等与审计、保留期/备份安全、清理作业状态及失败重试；批量操作、影响预览和 UI Undo 为可选扩展。未来 Plugin 顺序为 Detach → 引用影响查询 → 明确确认/可选 Undo → Resource soft-delete → Restore/GC。

本片不修改 Server/API/OpenAPI、Attachment wire types、offline 只读、Mutation/Conflict/revision/changeCursor；current-main 真实 Obsidian smoke 仍为 `UNVERIFIED`。S3-C3-C3 资源级实现、S4、S5、S6 均未开始。

## S3-C3-C4 实施记录：Attachment Download source-aware routing（2026-09-01）

本片从 connector 核验的 Plugin main `9aad88eed8b64d17449dbdc7bd7da58369ce8d31` 开始，修正 Attachment Download 在 Detail 的来源路由，并补齐 Grid-opened Detail 与 Map selected-record Detail 的实际 host wiring。Grid/Map compact 摘要仍保持 non-interactive。

本片保持已发布合同：`source=managed` 的 ready Attachment 通过现有 `downloadAttachmentContent` content GET 获取 bytes，复用 Blob/object URL、安全 basename 与 `finally` revoke；Managed offline 显示翻译后的 disabled 说明且不发起请求。`source=vault` 仅在 ready、具备 identity 且 `vaultPath` 为明确安全相对路径时，通过 Obsidian Vault API 精确解析 `TFile` 并 `readBinary` 后触发下载；Vault 本地下载允许 offline，且不调用 Server content endpoint、不写入或删除 Vault、不猜路径。unknown/缺失 identity/不安全或缺失路径/非 ready（pending/stale/invalid/unknown）保持 actionless。

自动化回归覆盖 Managed 与 Vault 分流、Vault exact-path/TFile 校验、offline no-request、unsafe/unknown/missing identity、文件名与 MIME、object URL cleanup、Grid Detail/Map Detail wiring、重复/无效 action 以及 ARIA/i18n。当前 clean staging 的完整 `pnpm check` 已通过：format、lint（既有 warnings，无 error）、typecheck、46 个测试文件 / 415 个测试、OpenAPI drift 与 production build。

本片不改变 Attachment wire types、Mutation/Conflict/revision/changeCursor、offline 只读语义或 Server/API/OpenAPI；不实现 Vault 写入/删除、Open/Preview、Add/Upload、Detach/Retry 或资源生命周期。current-main 真实 Obsidian smoke 仍为 `UNVERIFIED`，不能以 DOM/CI 替代桌面验收；S4/S5/S6 不在本片。

## S3-D 字段能力审计与 Date Renderer parity（2026-09-01）

本片从 connector 核验的 Plugin main `1a47b21d86dbda1a42fb276193ab839163927ca7` 开始，交付后当前 main 为 `622aae40af1f64331cc34e0d308f47c1422e0fc9`。代码 PR [#105](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/105) head `5f6b0c82f2eec90903b2a7f6c2c34ffce53affa3`，PR CI `33512486961` / job `99871329184` 和 main push CI `33512658719` / job `99871896971` 均成功。

实施前的 current-main 审计按十种批准字段核对了 `field-renderer-registry.ts`、`field-value-editor.ts`、Grid/Detail/Map 调用方及公开测试：Text、LongText、Number、Checkbox、URL、Select、MultiSelect、Location、Attachment 的既有共享显示/编辑或专用流程已满足当前发布范围；唯一可复现的 scalar parity gap 是 Date renderer 接受任意非空字符串，而既有 editor/Server 合同只接受有效 Gregorian `YYYY-MM-DD`。

最小修复让 Date renderer 复用既有 `normalizeCellValue`：无效日期显示翻译后的 unavailable，不把服务端异常值作为普通文案；合法带空格日期沿用现有规范化结果。回归测试覆盖无效日期和合法规范化显示；没有改变 Date editor、set/unset、Mutation Queue、Conflict、expectedRevision、clientMutationId、changeCursor 或 Attachment/Location 语义。完整 `pnpm check` 已通过（46 个测试文件 / 416 tests、format、lint 既有 warnings、typecheck、OpenAPI drift、production build）。

本片不把真实 Obsidian smoke 当作代码缺口：current-main 桌面 smoke 仍为 `UNVERIFIED`，DOM/CI 不能替代窗口验收。没有新增 Server/API/OpenAPI 合同，不改变 offline 只读边界。S3 的 Attachment 资源级 Delete/Restore/GC 仍因未发布的引用影响/所有权/恢复/清理合同而 deferred；Map preview、S4、S5、S6、新字段、View、CRUD、Filter/Sort、Dashboard 均未开始。

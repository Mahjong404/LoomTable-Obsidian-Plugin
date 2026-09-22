# P1.5：View 与 Grid

需求 ID、字段能力和通用工程规则见 [总要求](./README.md)。本文件确定实现行为；文件名建议不要求机械照搬，生产接线和行为必须完整。

## V1：Table Shell 与导航

1. 建立 Grid/Map 共用的 Table Shell，显示 Workspace → Base → Table 上下文、已有 View Tabs、添加 View、View 管理和聚合保存状态。可以保留上级资源选择器；View 导航用 Tabs。
2. Tabs 只列 active Views，保留 Server 列表顺序；按稳定 ID 选择。展示同名 View 时允许用类型作辅助，不以名称去重。键盘支持 Left/Right、Home/End 移动焦点，Enter/Space 激活；使用 tablist/tab/tabpanel 及 `aria-selected`。
3. 添加入口只提供 grid/map；Map 要有当前 Table 的 active Location Field。无字段时说明原因，不提供本期未实现的字段创建假按钮。
4. 切换先处理未提交草稿；用户取消则原 View、草稿、焦点不变。成功切换使旧读请求失效，再挂载对应内容。Shell 不因数据刷新整体销毁；Map 卸载清理 renderer/监听器，已提交 Mutation 仍由 runtime 持有。
5. 当前 View 被删除或失去访问时刷新列表，按“下一个 active View → 上一个 → 空 View 状态”选择；没有 View 时展示显式创建/恢复入口，不自动重建 Grid。
6. 在同 Leaf 内按 profileId/serverOrigin/workspaceId/baseId/tableId/viewId 隔离选择、草稿和查询状态。重命名不影响身份。不同 profile/连接的相同对象 ID 不能复用内容。

## V2：View Client 与管理

### 客户端补齐

在 `src/client/loomtable-client.ts` 声明领域类型/方法，`http-loomtable-client.ts` 实现并验证响应，测试 fake 同步支持：

| 方法建议 | 已发布路由 | 要求 |
| --- | --- | --- |
| getView(viewId) | GET /v1/views/{viewId} | 可读自身已删除的 View；祖先不可访问为 404 |
| createView(tableId, request, idempotencyKey) | POST /v1/tables/{tableId}/views | body 为 name/type/config；必填 `Idempotency-Key: mut_...`；201 返回 View |
| updateView(viewId, request)（已有） | PATCH /v1/views/{viewId} | type/config/expectedRevision，name 可选；200 返回 View |
| deleteView(viewId, expectedRevision) | DELETE /v1/views/{viewId}?expectedRevision=... | 204 无 body，不做 JSON 解码 |
| restoreView(viewId, expectedRevision) | POST /v1/views/{viewId}/restore | body 仅 expectedRevision；200 返回 View |
| listViews(tableId, { lifecycle })（已有） | GET /v1/tables/{tableId}/views?lifecycle=... | active/deleted/all；完整非分页列表，硬上限 100 |

创建/更新请求采用 grid/map 判别联合，不接受任意 JSON。名称按 Server 规则处理：Unicode 首尾空白去除、NFC、非空、无控制字符、最多 200 码点；同名允许。保留 `RESOURCE_LIMIT_EXCEEDED`、`INVALID_STATE_TRANSITION`、`VIEW_CONFIGURATION_REQUIRED` 和 `CONFLICT` 的可识别信息。

### 用户操作

- 新 Grid：用户确认名称后创建完整 config：projection/columnOrder 为 Primary Field，widths 空对象、frozen 空数组、standard、sort 空数组，无 filter。Primary Field 来自 Table，不猜第一字段。
- 新 Map：用户明确选择 Location Field；只有一个候选可以预选，但仍要确认创建；初始 config 仅 locationFieldId，除非用户在表单显式设置其他支持项。
- 复制：复制当前已保存 View 的 type/config，并让用户确认新名称；不复制 Record、ID、revision、deletedAt、Provider Credential、临时 Search 或临时相机。源配置失效时先修复，不能默默丢掉筛选后复制。
- 重命名：即使只改名称，PATCH 仍提交当前完整 config 和 revision。
- 删除：明确对象名称及“只删除视图，不删除记录”，确认后执行；成功后重新读取 active 列表，并使该 View 的缓存及读请求失效。
- 回收列表：管理面板通过 `lifecycle=deleted` 查询；恢复使用已删除 View 的最新 revision，成功后重读列表并可选择恢复后的 View。没有 View 也能打开该面板。
- 配置修复：展示 `brokenFieldIds` 对应的字段/不可用标记；用户删除无效 Filter/Sort/Projection 引用，或明确重选 Location Field后保存。查询语义引用不能静默换字段；presentation-only 的陈旧 order/width/frozen 引用可忽略显示，并在用户保存时清理。

### 完整替换与并发：必须按此逻辑处理

每个 View 保有 `savedView`、编辑草稿、草稿基准 revision、inFlight、错误；控制器持有状态，DOM 仅渲染。

1. 打开配置表单时从 savedView 深复制草稿。修改不直接覆盖 savedView；每个 View 同时最多发送一个元数据写请求，pending 时禁用该 View 其他写入口。
2. 应用时检查表单有效、身份未变化、基准 revision 仍匹配。只改变用户触及的 config 成员，完整携带其余成员；不能由 Filter 表单省略 width/frozen/rowHeight，或由 Map filter 表单省略 center/zoom。
3. PATCH 返回完整 View 后，以返回值替换 savedView；可能是 no-op，不能自行 revision+1。保留草稿直到响应确认成功。
4. 400/422：保持原已保存行为、保留草稿，定位字段/规则错误。401/403：保留意图并暂停写入，显示连接/权限动作。
5. 409 元数据冲突是普通 ErrorResponse，不是 Record ConflictResponse。读取最新 getView；展示“配置已在其他位置更改”。提供采用最新值或重新编辑；禁止自动把旧完整 config 覆盖到新 revision。用户重新应用时，以最新完整 config 为底，仅套用明确保留的修改，并使用新 revision。
6. 超时/网络异常可能已写入：先进入结果待确认，读回对象/列表。内容等于目标则按读回确认；仍为原 revision 时允许用户重试原请求；其他内容/revision 进入冲突。读回失败保持待确认，不报成功也不无限重发。
7. DELETE 未知结果通过 getView/deleted 列表确认 deletedAt；404 不等于本次删除成功，可能是祖先不可用。Restore 以读回 active 状态确认；不能对新 revision 自动再执行。
8. 创建和复制的一次逻辑意图保留同一 `mut_...` key、method/path/body，有限重试或用户重试复用；不能按名称猜是否成功。未知结果期间禁止改 body 沿用 key，也不能换 key重复创建。保存未解决意图的最小可恢复状态到现有 profile 隔离的存储，不包含凭据；幂等保留期过后需核对列表并让用户明确决定，禁止自动重放。

Map Default Camera、Map Filter、Location Field 修复与管理面板的修改必须共用同一 View 写入协调。不能继续保留两个互不感知的 PATCH owner。

### 保存与读取的两个结果

配置已保存但随后的 Query 失败时，保留 Server 返回的新配置，显示“配置已保存，数据刷新失败”并提供刷新。不能把已保存配置回滚为旧 config。配置写入失败时则继续展示旧配置对应的数据并保留失败草稿。保存状态聚合不能让 Record 成功覆盖 View 写入失败，反之亦然。

## V3：Filter、Sort、Search 与查询

### Filter Builder

- 支持增加/删除规则和嵌套 AND/OR Group、切换组关系、字段/操作符/值编辑。根节点可以是规则或组；根深度为 1，最多深度 8、总计 100 个规则加组；每组至少一个子节点。
- 草稿可暂时不完整；无效草稿在对应位置就地标记错误且不提交，恢复合法后自动生效。删除最后一个根规则表示无 filter；删除非根组最后一项时删除该空组并向上收敛，不能提交 children=[]。
- operator 只来自总要求的类型矩阵。变更字段或 operator 时，丢弃不再适用的 operand，并等待用户补全；不隐式把字符串转成数字/布尔。
- `isEmpty/isNotEmpty` 必须省略 value，不能发送 null。其余 operator 必须有类型正确的非 null 值。Number 是有限数，Date 为 YYYY-MM-DD，Checkbox 是 boolean，Select/MultiSelect operand 均为单个 option ID（不是数组）。
- Filter 可选择本字段保留的 deleted option，并明确标注，用于查询历史引用；这不同于新 Record 禁止新引入 deleted option。未知 option 不可用。
- 文本 Filter operand 保留用户首尾空白。URL 的 contains/prefix 等 operand 可以是片段，不能使用只允许完整 HTTP URL 的 Cell 校验器。Server 负责 Unicode 匹配；客户端只验证结构，不计算匹配集合。
- Filter/Sort/Display 面板统一采用“草稿即时校验 + 防抖自动生效”模型：编辑产生草稿，经约 300ms 防抖后自动提交并保存完整 View config，不提供显式“应用/取消”按钮。“清除筛选”是显式提交无 filter 的操作；关闭面板不改变已保存 Query。存在未生效草稿时面板实例保持不被重建。
- 显示已应用条件摘要/规则数量；无结果提供清除筛选和返回编辑入口。不要根据当前缓存推算其他页是否匹配。

### Sort

- 简单表头操作循环“无排序 → 升序 → 降序 → 无排序”，默认 nulls=last。点击另一个字段切换为该字段的单字段排序。
- 已有多字段排序时表头动作应打开排序面板并定位该字段，避免一次点击抹掉其他规则。
- 多字段面板支持新增、删除、上移/下移、asc/desc、nulls first/last；最多 10 个不同 fieldId；与 Filter 采用同一防抖自动生效模型。
- MultiSelect/Location/Attachment 不显示可执行排序。空排序由 Server 使用 createdAt ASC、id ASC；不要提交虚构的系统字段排序。
- Server 追加 Record ID ASC 稳定尾序；Select 的 Active/Deleted 桶与空值顺序由 Server 处理，客户端不按 option name 重排。

### Search

- Grid 工具栏提供当前 Leaf/View 的临时 Search，Enter 或搜索按钮提交，清除按钮重新查询；输入期间不发请求。最多 500 个 Unicode 码点，首尾空白规范化后空串即无 Search。
- Search 只用于 Server 支持的 Primary/Text/LongText/URL 包含查询，不保存入 GridViewConfig，不假造 Map 的请求级 Search。Map Shell 不显示无效 Search 控件。

### Query 与 Cursor：统一失效

每个读请求绑定完整上下文（连接、Table、View、View revision、等价 Query、lifecycle）及递增 request generation。改变 Filter/Sort/Search/Projection/lifecycle 或保存产生新 View revision 后，递增 generation，清空旧 nextCursor/hasMore/totalCount，从第一页查询。即使只改行高使 View revision 变化，也不能拿旧 Cursor 续页；旧内容可作为加载占位，必须标明刷新中。

Grid query body 只含合同字段 viewId/lifecycle/cursor/limit/projection/filter/sort/search；tableId 仅用于路由。可以用 viewId 读取已保存 config，也可以显式发送与已保存值一致的查询成员；不可发送 width/order/frozen/rowHeight。清除已保存 filter 必须先成功保存无 filter 的完整 config，仅省略请求 filter 会继承旧 View filter。

1. 首屏/续页 success 或 error 只有身份和 generation 均匹配才可发布；过时请求不得写入列表、计数、缓存、cursor、错误或把新请求的 loading 清掉。
2. 同 Query 一次只请求一个下一页；loading 锁归属于 generation。更换 Query 后旧请求 finally 不能解锁新请求。
3. 同一 generation 续页按 Record ID 去重并保持 Server 顺序；首屏替换分页集合，不能混入旧 Query 结果。普通 cursor 允许并发写导致成员变化，不宣称快照分页。
4. 第一页的 totalCount 是本次匹配数，不是 Table 总数；续页缺少 totalCount 时保留本轮首屏值。筛选/搜索条件存在且结果为零显示“没有匹配记录”，无条件零条显示空表，不声称从条件查询推断全表为空。
5. 410 只允许对当前 generation 丢弃 cursor 并重读一次首屏；再次失败显示错误。400 INVALID_CURSOR 不无限重试，保留诊断并允许显式刷新。
6. Mutation/Change 使相关 Table/查询缓存失效并定向重查；由 Server 决定新成员与顺序。不要因一个 Cell 保存失败而重新加载全部资源树。

## V4：列显示与行高

| 控制 | 保存成员 | 具体规则 |
| --- | --- | --- |
| 显示/隐藏 | projection | 按字段勾选，至少保留一个可见字段；本期新保存显式非空列表，Primary Field 可隐藏，行级详情入口仍在 |
| 顺序 | columnOrder | 上移/下移按钮，无需拖拽；仅表示顺序，不决定可见集合 |
| 宽度 | columnWidths | 数值输入，80–1000 CSS px 整数；恢复默认移除该键，默认沿用 180px |
| 冻结 | frozenFieldIds | 可见字段的冻结开关；实际冻结区置于左侧，内部顺序取 columnOrder；取消冻结回到普通顺序 |
| 行高 | rowHeight | compact/standard/comfortable，对应当前 30/36/44px；渲染与虚拟窗口测量使用同一数值来源 |

显示面板与 Filter/Sort 统一采用防抖自动生效模型。宽度输入校验不能静默截断无效值；旧配置渲染可沿用防御性宽度 clamp。不要把“只保存配置但 UI 不生效”当完成。

解析顺序：从 active fields 得到合法字段集 → projection 得到可见集 → 按 columnOrder 排列可见字段 → 未列入 order 的可见字段按 position/id 补到末尾 → 按冻结标志稳定分为左侧冻结区与普通区。隐藏列不得因为仍在 columnOrder 而出现。

兼容旧空 projection：现有客户端/服务端默认路径视作所有 active fields，打开面板时展开成显式列表；不将空数组用作“隐藏所有列”。展示型陈旧 ID 安全忽略，查询型失效引用按 V2 修复。

冻结表头与各行必须共用相同左偏移：行操作列宽度 + 此前可见冻结列的有效宽度；用 scoped sticky/等价实现，设置背景和层级避免滚动透字。每个逻辑 Cell 仅一份可聚焦编辑 DOM。隐藏冻结列时移出 frozenFieldIds；窄布局仍可横向滚动查看未冻结列，不能被冻结区完全挡住，必要时仅在窄布局暂时取消 sticky 并显示说明，保存配置不变。

行高修改后按首个可见 Record 和行内偏移恢复滚动锚点，重算占位与窗口；长文本/Chip/附件摘要截断并在 Detail 看完整，不能撑破固定行高。

## V5：编辑、焦点与详情

- 单击选中/聚焦，双击或 Enter 编辑；可打印字符从非编辑 Cell 进入替换编辑。Enter 提交留在当前 Cell，Tab/Shift+Tab 成功提交后移动到相邻可编辑 Cell；失败留在原草稿。IME composition 时不误提交。
- 非编辑方向键移动，编辑中方向键归原生控件；复杂字段打开共用 Detail。不为了虚拟滚动卸载编辑器而丢草稿或提交两次。
- 单 Cell 复制/粘贴走 clipboard host seam；粘贴按目标类型校验后走既有编辑队列。文本保留原样，结构型字段仅支持已定义的单值序列化，不能把任意 JSON 当合法值；不支持的粘贴给出明确提示。Delete/Backspace 的清空写 null；Unset 是单独动作，沿用确认。
- 焦点身份含 Table/View/Record/Field（外层含连接身份）。字段隐藏或 Record 离开结果时，按同一行邻近可见列 → 相邻可见行 → 表头/空态主动作回退；不能回到 document body。Header/Record 操作也有稳定 key。
- Detail 打开加载完整 Record，标题取 primaryFieldId 或本地化“无标题”；上一条/下一条沿当前 Server 查询序列，边界可以显式加载下一页。未知前页禁用上一条，不编造反向 Cursor。
- 导航处理未提交草稿；已提交操作继续保存，Error/Conflict 保留可发现入口。关闭返回调用处或稳定回退；重绘不重建仍在编辑的 Detail。
- 行虚拟化继续限制 DOM 为可见窗口加 overscan；20k fixture 不生成 20k DOM，不为了排序/搜索抓全表。列虚拟化及拖拽优化不在本期。

## 行为验证

覆盖 V1–V5 的真实 controller + DOM + in-memory client 组合，另外用 recording transport 验证新增 View 路由和 body。必须包含：取消零写入、同名 View、零 View、删除当前 View/恢复、409 两类响应、超时后读回、重复创建 key、Map camera 与 Filter 并发、隐藏列残留在 order、冻结偏移、三种行高、嵌套边界、非整串 URL operand、deleted option Filter、Search 临时性、快速切换后的旧成功/失败/410/finally、Query 成功前后 Mutation 和焦点回退。详细交付门禁见 [工作流](./workflow.md)。

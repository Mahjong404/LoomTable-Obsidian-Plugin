# Grid View 规范

## 目标

Grid View 是第一阶段的核心交互。它必须支持约 20k Records 的浏览、筛选、排序和编辑，同时避免把完整数据集转换成完整 DOM。

当前 UI 收敛目标与 API 门槛见 [Wave 1.5](../wave1.5/README.md)，本文件维护 Grid 专属约束。P1.5 已交付基础见 [View 与 Grid](../p1.5/view-grid.md)；已有 UpdateRecord 持久化队列继续复用，新增单条生命周期按 [Record 生命周期](../p1.5/record-lifecycle.md) 实施。逐字段合并、离线新写入和列虚拟化不在 P1.5 交付范围。

## 结构

```text
Grid View
├── View Toolbar
├── Filter / Sort Summary
├── Column Header
├── Virtualized Row Window
├── Frozen Columns
├── Horizontal Scroll Area
└── Record Detail Entry
```

## 数据流

```text
View Config
    ↓
Query Request
    ↓
Server-side Filter / Sort / Cursor
    ↓
Page Cache
    ↓
Virtualized Row Window
```

Plugin 不应为了显示一个 View 而下载全部 20k Records。查询结果需要带有：

- Record 数量提示或是否还有下一页。
- `nextCursor`。
- 当前 `changeCursor`。
- 服务器应用后的排序和筛选状态。

## 虚拟化

P0 使用原生 DOM 自定义行虚拟化，并采用固定行高模式：

- 只渲染视口附近的行。
- 行进入和离开窗口时复用 DOM。
- 保留滚动高度占位。
- 复杂 Cell 不在不可见区域创建编辑器。
- P0 不实现列虚拟化，但为未来列虚拟化保留 Grid Renderer Interface。

固定列和列宽属于 View Config，不能写入 Record。

## Column Header

Column Header 本身是整列的可聚焦交互目标，而不是包在字段名外的排序按钮：

- 单击列头主体选中整列；不触发排序，也不进入编辑。
- 双击列头主体或 `Enter` 打开 Field Editor 编辑该字段；`Space` 选中整列。
- `←` / `→` 在列头之间移动焦点；`ContextMenu` 键或右键打开列菜单。
- 拖拽列头主体调整字段顺序，按落点在目标列的左/右半分为 before/after，写入 View 的 `columnOrder`；恒等落点不产生写入。
- 拖拽两列之间的分隔线调整列宽，不得误触选择、重排、编辑或菜单。
- 列菜单保留编辑字段、修改字段类型、数字格式、插入、复制、升序/降序排序、筛选、隐藏、删除。
- 排序不绑定列头点击；显式入口为 Sort 工具栏/面板与列菜单。列宽通过分隔线拖拽调整；Display Panel 维护显示/顺序/冻结/密度，不另提供 Width 输入。

## 编辑

基础字段支持：

- 单击选中，双击或 Enter 进入编辑。
- Enter 提交。
- Esc 取消。
- Tab / Shift+Tab 移动。
- 方向键移动。
- Ctrl/Cmd+C 和 Ctrl/Cmd+V。
- Delete/Backspace 清除。
- IME 输入法组合状态。

复杂字段使用 Popover 或详情面板：

- Location
- Attachment
- Relation
- LongText
- 未来的 Formula 配置

P0 剪贴板只支持单个 Cell 的复制和粘贴。矩形 TSV 多 Cell 粘贴延后实现；粘贴值必须先经过目标 Field Type 的校验和标准化，非法值不得产生部分 Mutation。

## 保存

1. Cell 进入 editing 状态。
2. 用户提交值。
3. Field Type 校验和标准化。
4. UI 进行乐观更新。
5. Client 发送带 `expectedRevision` 的 Mutation。
6. 成功后替换为服务端值和新 Revision。
7. 失败后恢复或标记 conflict/error。

单元格失败不能导致整张 Table 重新加载。

同一 Record 的编辑进入 FIFO Mutation Queue，不同 Record 可以并行保存。当前 Record 发生 Conflict 后暂停其后续 Mutation，直到用户放弃本地修改、采用服务端值（use-server）或明确覆盖（overwrite）。当前切片不提供逐字段合并；它保留为 backlog。覆盖必须创建一次使用当前 Revision 的新 Mutation。

## Record 生命周期

P1.5 要实现单条 Create/Delete/Restore。Create 不需要 `expectedRevision`，Delete/Restore 使用当前权威 revision；具体产品流程、队列兼容和重试见 [Record 生命周期](../p1.5/record-lifecycle.md)。

## Filter、Sort 和 Search

- Filter Builder 根据共享字段能力只显示该 Field Type 支持的 Operator。
- 支持嵌套 `AND` / `OR` Filter Group；单条条件以裸规则呈现，出现第二条条件才升级为分组（见 HIG 的 Filter 渐进披露）。
- 新建条件的缺值/无效值错误在该行被编辑或失焦后才就地提示；未完成草稿不提交 Server。
- 支持多字段 Sort，并明确每个 Sort 的方向和空值位置。
- Filter、Sort 和 Search 全部提交 Server 执行；Plugin 不对缓存页进行本地重算。
- 修改 Query 后丢弃旧 Query 的分页 Cursor，从第一页重新加载。

## View 配置

Grid View 可以保存：

- 显示字段。
- 字段顺序。
- 字段宽度。
- 固定字段。
- 行高模式。
- Filter。
- Sort。
- Group 配置预留。

这些配置属于 View，不属于 Table Record。

## 状态

Grid 从 View Controller 接收正交的 Connection、Content 和 Edit 状态。至少必须能够表达：

- `online + loading + readonly/editable`：正在获取当前窗口。
- `online + empty + editable`：Table 没有 Record。
- `online + no-match + editable`：有 Record，但当前 Filter 没有匹配。
- `offline + ready + readonly`：只能读取缓存。
- `online + ready + conflict`：Mutation 基于过期 Revision。
- `server-error + ready/idle + readonly`：服务端操作失败，可保留已有缓存内容。

## Wave 1.5 Grid 实施合同

此节定义批准的目标 Grid 行为，任务/完成状态见 [Wave 1.5](../wave1.5/README.md)。现有 keyed DOM/rAF、虚拟化、Column Header 主体选择与已交付列重排应保留；只修真实差异，不重建 Grid/Server。通用接受/焦点/浮层见 HIG，Token/glyph/Tag 视觉见 DS。

### 共享几何与命中

- Regular system track 宽88，Row Header 基准88×36：2px外距+三28px槽+2px外距，中心 x16/x44/x72。三槽分别承载 handle、序号/checkbox、detail；checkbox box14，中心x44；右 rail 为x87、宽1px。
- coarse 模式整个 Grid 的 system track 为132，Row Header132×44、三44px槽；Header/body/Add/Footer/冻结偏移使用一致 track width，不能靠 hover 改行宽或把触控目标叠在88px里。
- Header 和 Aggregate Footer 各固定36高，独立于数据行30/36/44密度；Add Field tail56，Add row36。Header/body/footer/range/canvas 共用 resolved columns、width、frozen offsets 和 scrollLeft；Frozen 是任意子集，不限 prefix。
- system rail 固定在 viewport 的 system track 右边，随当前模式取边界，不随横向内容移动。普通 row bottom/right1px边界贯通 Header/Footer，overlay 不吞 divider。Footer 不被 Add/行密度遮盖；viewport 只有一个竖向 scroll owner。
- Typed Header 包含实际 Field type glyph14、name、Pin、More28 与 resize8。以216px列为例，More x180–208、resize x208–216；宽度变化时保持不重叠，独立于 header 主体选择/编辑/列重排。
- Row reorder 仅 handle 启动；checkbox、detail、blank 不拖。保既有 manual/query/权限资格检查、恒等落点零写、pointercancel 释放，并提供可访问 Move 菜单/键盘替代。detail 点击只打开 Record，透明 target 与 glyph 按 DS。
- 序号是当前 Query 的1-based ordinal，不是 DOM index/Record ID；Add/blank 不制造数据序号。空 Grid 无 Current，正常可用 Grid 恰一个 Current；Hover、Row Selection、Current、drag session 正交，Current 最后2px overlay。

### 编辑器与校验

输入先 validate 再结束/commit；invalid raw 保留在原编辑 context，用 anchored bubble 解释，不推高行/移动下一行。不把网络保存中/失败/Conflict重新画成 Cell 状态。实际写入仍是既有 Controller/Queue，不能另建保存系统。

Date owned overlay 包含全部内部控制与 child，内部 blur/Tab 不结束 Grid editor 或提交 Draft row。Confirm/outside/真正Tab离开/失败/context 采用 [HIG DatePicker](./interaction-hig.md#datepicker)，持久 Record 与 Create Draft 的 adapter 按 [Editor Lifecycle](../architecture/field-editor-lifecycle.md)。已发 Mutation 不因 editor detach 假取消。

### 列配置与 Aggregate

Display/Header freeze 使用同一命令；hide 移除 frozen，但保 active hidden Field width，re-show 不自动 refreeze。完整 View config CAS 由已有 coordinator 持有，Display 的旧 draft 不能覆盖 Header resize 最新 width；至少一个 visible Field。obsolete ID 清理与 hide 不同。

Toolbar 基础行数与列 Aggregate 分开；Footer 不重复 loaded/total。Count 是 non-null count；Number 支持 Count/Sum/Average/Min/Max，Date 支持 Count/Min/Max，其他 eligible type按既有能力用Count。None/Clear 是 Quiet，未激活时禁用；空值显示批准 dash，不能编造0或在缓存页求和冒充全Query。

当前 AggregateRequest 只支持 Filter。非空 Search 时，匹配范围的数值 Aggregate在 [G6](../wave1.5/api-boundary.md#g6--aggregate-与-filtersearch-query-同域) 交付前明确 unavailable；Footer 几何和既有无 Search 聚合可以先交付。缓存 key/迟到响应必须包含当前有效 query，G6 接入后与 Record Search 同域。

### Query-wide Row Selection — Gated

Header 目标是全 Filter+Search membership，而非 loaded IDs。空范围 disabled、部分选择 unchecked，无 mixed。scope/count/token/exclusion/expiry由 [G4](../wave1.5/api-boundary.md#g4--whole-query-rowselection-scope) 交付；缺 capability 时不假装全Query已选，也不拉完整Table补齐。

Current 与 Ctrl/Cmd+A 的已交付 Cell rectangle独立；Row Selection 不隐式清 Current。Sort/Display不改变membership，Filter/Search或有效数据/权限上下文改变需按正式scope合同失效。Selection 批准不自动授权bulk Mutation。

### 连续加载

保现有 opaque cursor、page100/max500、query epoch、dedupe、bounded DOM 和 rAF。接近tail约2 viewport提前加载，初始underfill有界继续直到填满/end；重复阈值只单flight，不自动下载全Table。

已加载rows保持ready/editable；incremental loading/error/hasMore独立，正常Load More入口由自动续页替代，失败在tail提供retry。append保Current/editor/selection/scroll；late page/error不发布到新query/context。410重查首page并保可用anchor/clamp，end/空页不能无限循环。真实滚动/冻结/布局与资源释放需要宿主QA。

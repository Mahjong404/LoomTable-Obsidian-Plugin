# Grid View 规范

## 目标

Grid View 是第一阶段的核心交互。它必须支持约 20k Records 的浏览、筛选、排序和编辑，同时避免把完整数据集转换成完整 DOM。

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

## 编辑

基础字段支持：

- 点击或 Enter 进入编辑。
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

同一 Record 的编辑进入 FIFO Mutation Queue，不同 Record 可以并行保存。当前 Record 发生 Conflict 后暂停其后续 Mutation，直到用户放弃本地修改、采用服务端值、明确覆盖或逐字段合并。覆盖与合并必须创建新的 Mutation。

## Record 生命周期

P0 Grid 支持创建、编辑、软删除和恢复 Record。软删除前必须确认；P0 不提供不可恢复的硬删除入口。删除和恢复均携带 `expectedRevision`，并遵守与 Cell 编辑相同的 Conflict 处理规则。

## Filter、Sort 和 Search

- Filter Builder 根据 `FieldTypeRegistry` 只显示该 Field Type 支持的 Operator。
- 支持嵌套 `AND` / `OR` Filter Group。
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

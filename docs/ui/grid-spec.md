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

第一阶段优先实现行虚拟化：

- 只渲染视口附近的行。
- 行进入和离开窗口时复用 DOM。
- 保留滚动高度占位。
- 复杂 Cell 不在不可见区域创建编辑器。
- 为未来列虚拟化保留 Grid Renderer Interface。

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

## 保存

1. Cell 进入 editing 状态。
2. 用户提交值。
3. Field Type 校验和标准化。
4. UI 进行乐观更新。
5. Client 发送带 `expectedRevision` 的 Mutation。
6. 成功后替换为服务端值和新 Revision。
7. 失败后恢复或标记 conflict/error。

单元格失败不能导致整张 Table 重新加载。

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

必须区分：

- Loading：正在获取当前窗口。
- Empty：Table 没有 Record。
- No Match：有 Record，但当前 Filter 没有匹配。
- Offline：只能读取缓存。
- Readonly：当前操作不允许编辑。
- Conflict：Mutation 基于过期 Revision。
- Server Error：服务端操作失败。


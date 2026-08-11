# LoomTable Obsidian Plugin 详细设计

## 1. 生命周期

```text
onload
├── 读取 Plugin Settings
├── 注册 Commands、Workspace View 和设置页
├── 初始化 LoomTableClient
├── 初始化 FieldTypeRegistry 和 ViewTypeRegistry
└── 监听 Obsidian Layout Ready

onunload
├── 取消活动请求
├── 停止轮询
├── 销毁 View 和 Editor
└── 清理事件监听器
```

Plugin 不在 `onload` 中强制连接 Server；连接在用户打开 LoomTable View 或主动执行连接测试时建立。

## 2. 模块 Interface

### LoomTableClient

```ts
interface LoomTableClient {
  getMeta(): Promise<ServerMeta>;
  query(request: QueryRequest): Promise<QueryResult>;
  mutate(request: MutationRequest): Promise<MutationResult>;
  pullChanges(request: ChangeRequest): Promise<ChangePage>;
}
```

HTTP、认证、重试和错误映射集中在 Client Adapter 中。

### View Controller

View Controller 负责：

- 当前 View 身份。
- 当前 Query 状态。
- 当前窗口数据。
- 加载和错误状态。
- 轮询与刷新。
- 组件销毁时取消请求。

View Controller 不负责绘制 DOM；它向 Grid 或 Map 提供稳定的 View Model。

### FieldTypeRegistry

```ts
interface FieldTypeRegistry {
  register(definition: FieldTypeDefinition): void;
  get(typeId: string): FieldTypeDefinition;
  has(typeId: string): boolean;
}
```

Field Definition 同时提供 Renderer、Editor、校验、标准化、序列化和查询操作。

## 3. View 状态

```text
uninitialized
    ↓
loading
    ├── ready
    ├── empty
    ├── no-match
    ├── offline-readonly
    ├── conflict
    ├── auth-error
    └── server-error
```

状态必须由状态模型驱动，不能通过某个组件是否存在来推断。

## 4. Grid 请求流程

```text
View Controller
    ↓ QueryRequest
LoomTableClient
    ↓ HTTP
Server Query Engine
    ↓ QueryResult + nextCursor + changeCursor
Page Cache
    ↓ visible range
Grid Renderer
```

Grid 只请求当前窗口和相邻页面。Filter、Sort 和 Search 由 Server 执行。

## 5. 编辑流程

```text
Cell Editor
→ Field Type validate
→ Field Type normalize
→ 乐观更新 View Model
→ Mutation(expectedRevision)
→ 成功：应用新 Revision
→ Conflict：进入冲突 UI
→ 失败：恢复旧值并展示错误
```

每个 Cell 编辑必须可以独立失败，不得因为一个 Cell 失败而重新加载整张 Table。

## 6. 缓存策略

- 缓存最近访问的 Workspace、Base、Table 和 View 元数据。
- 缓存当前 View 的可见页和相邻页。
- 缓存不拥有 Record 的事实来源权。
- 服务不可用时允许读取缓存，但第一阶段不允许离线写入。
- 缓存必须带 Server URL、API 版本和数据版本标识。
- 切换账号或 Server 时不得混用缓存。

## 7. 响应式实现

- 桌面使用完整 Grid。
- 平板保留 Grid，工具栏可折叠，交互支持触控。
- 手机优先显示 Record 卡片和详情面板。
- 手机横屏可以显示简化 Grid。
- Map View 使用触控拖动、缩放和 Marker 选择。
- 所有布局使用容器查询或明确断点，避免依赖固定窗口宽度。

## 8. 错误和诊断

用户可见错误至少包含：

- 可读说明。
- 可执行的下一步动作。
- 错误码。
- Request ID 或诊断 ID。

内部日志不得记录 Token、完整 Record 内容或附件内容。

## 9. 测试

- Field Type 纯逻辑测试。
- View Controller 状态测试。
- InMemoryLoomTableClient UI 测试。
- Grid 键盘和编辑测试。
- 真实 Obsidian Workspace View Smoke Test。
- Light/Dark、桌面/平板/手机布局测试。
- 20k 数据量虚拟化和滚动基准测试。


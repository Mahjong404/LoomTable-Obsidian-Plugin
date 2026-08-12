# LoomTable Obsidian Plugin 详细设计

## 1. 生命周期

```text
onload
├── 读取 Plugin Settings
├── 注册 Commands、Workspace View 和设置页
├── 初始化 LoomTableClient
├── 初始化 FieldTypeRegistry 和 ViewTypeRegistry
├── 初始化 TileProviderRegistry、TileCredentialStore 和 MapRenderer Factory
└── 监听 Obsidian Layout Ready

onunload
├── 使活动 Client 调用失效并停止等待
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
  queryMap(request: MapQueryRequest): Promise<MapQueryResult>;
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
- 组件销毁时逻辑取消调用并丢弃迟到响应；生产 `requestUrl` 不保证终止已发出的底层传输。

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

### Map 适配边界

Map View 只依赖 `MapRenderer`、`TileProviderRegistry` 和 `TileCredentialStore`。P0 的 Renderer Adapter 是随 Plugin 打包的 Leaflet；OSM、天地图和 Custom XYZ 的差异封装在 Provider Registry 中。完整 Interface、配置 Schema、安全和验收要求见 [Map View 与瓦片提供方规范](../ui/map-spec.md)。

`MapRenderer.fitBounds` 封装容器尺寸、投影和反经线处理；Map View Controller 不依赖 Leaflet 类型。相机变化会逻辑取消上一笔 Map Query，并以 Request Sequence 和 View Revision 丢弃迟到结果。

## 3. View 状态

View 状态使用三个正交维度，不使用一个无法表达组合情况的总枚举：

```ts
type ConnectionState =
  | "uninitialized"
  | "connecting"
  | "online"
  | "offline"
  | "auth-error"
  | "server-incompatible"
  | "server-error";

type ContentState = "idle" | "loading" | "ready" | "empty" | "no-match";

type EditState = "editable" | "readonly" | "saving" | "conflict";
```

状态必须由状态模型驱动，不能通过某个组件是否存在来推断。例如，缓存内容可以同时处于 `offline + ready + readonly`；在线空表则是 `online + empty + editable`。

View Transport 使用 `type` 判别的 Grid/Map 联合类型，Config 不接受任意额外属性。P0 不允许改变已有 View Type；创建和更新都提交完整 Config，更新携带 `expectedRevision`，Server 校验、规范化后返回完整 View。

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
→ 进入当前 Record 的 FIFO Mutation Queue
→ Mutation(expectedRevision)
→ 成功：应用新 Revision
→ Conflict：暂停当前 Record 队列并进入冲突 UI
→ 失败：恢复旧值并展示错误
```

每个 Cell 编辑必须可以独立失败，不得因为一个 Cell 失败而重新加载整张 Table。

同一 Record 的 Mutation 按 FIFO 串行执行，确保后续编辑使用前一次成功返回的新 Revision；不同 Record 的队列可以并行。Conflict 只暂停发生冲突的 Record 队列，不阻塞其他 Record。

Conflict UI 必须展示本地提交值和服务端当前值，并提供：放弃本地修改、采用服务端值、明确确认后覆盖服务端值、逐字段选择。覆盖和逐字段合并都必须形成一次使用当前 Revision 的新 Mutation，不能由网络重试隐式完成。

## 6. 缓存策略

- 缓存最近访问的 Workspace、Base、Table 和 View 元数据。
- 缓存当前 View 的可见页和相邻页。
- 缓存不拥有 Record 的事实来源权。
- 服务不可用时允许读取缓存，但第一阶段不允许离线写入。
- 缓存必须带 Server URL、API 版本和数据版本标识。
- 切换账号或 Server 时不得混用缓存。
- Workspace、Base、Table 和 View 元数据保存在 Plugin Data；Record 页面保存在有容量上限的 IndexedDB Page Cache。
- 缓存键至少包含规范化 `serverOrigin`、API 版本、Actor/连接身份、Table ID、View ID 和等价 Query 指纹。
- 打开 View、View 重新获得焦点和用户手动刷新时检查变化；可见的活动 View 默认每 30 秒低频轮询，隐藏、休眠或卸载时暂停。
- Change 命中当前 Table 后，先使受影响的缓存页失效，再按当前 Query 定向重新请求；不能在 Plugin 中重算服务端 Filter 和 Sort。
- P0 不支持离线写入，也不在重新联网后自动重放本地编辑。

## 7. 响应式实现

- 桌面使用完整 Grid。
- 平板保留 Grid，工具栏可折叠，交互支持触控。
- 手机优先显示 Record 卡片和详情面板。
- 手机横屏可以显示简化 Grid。
- Map View 使用触控拖动、缩放和 Marker 选择。
- 所有布局使用容器查询或明确断点，避免依赖固定窗口宽度。
- P0 同时支持 Obsidian 桌面端和移动端。`manifest.json` 的 `minAppVersion` 固定为 `1.11.5`，以直接使用 SecretStorage；不为更低版本提供明文密钥兼容路径。

## 8. 错误和诊断

用户可见错误至少包含：

- 可读说明。
- 可执行的下一步动作。
- 错误码。
- Request ID 或诊断 ID。

内部日志不得记录 Token、瓦片 Credential、展开后的带密钥瓦片 URL、完整 Record 内容或附件内容。

Server Token 和瓦片 Credential 默认只存在于会话内存。用户显式选择“记住”时，通过 Obsidian `SecretComponent` 选择或创建可共享 Secret，Plugin Data 只保存 Secret ID 引用；停止记住只移除绑定，断开连接再清除会话值。Secret 读取失败时必须回到要求输入的状态。

## 9. View 身份和导航

每个打开的 LoomTable View 使用以下稳定身份：

```ts
interface LoomTableViewIdentity {
  serverOrigin: string;
  workspaceId: string;
  baseId: string;
  tableId: string;
  viewId: string;
}
```

对象名称只用于显示，不能作为导航、缓存或恢复 Workspace View 的身份。Plugin Commands 至少支持打开 LoomTable、刷新活动 View，以及创建/选择 Workspace、Base、Table 和 View。切换 `serverOrigin` 时必须隔离缓存、导航选择和会话 Token。

## 10. 工程基线

- 使用 TypeScript、esbuild 和 Obsidian 标准 Plugin 结构。
- UI 使用原生 DOM，不引入 React。
- Map View 使用随包发布的 Leaflet Adapter，不依赖外部 Obsidian 地图插件。
- 生产 Client 使用 Obsidian 官方 HTTP 能力。
- Plugin 保存版本化 OpenAPI 快照并生成 Transport Types；CI 检查生成结果是否漂移。
- `InMemoryLoomTableClient`、OpenAPI Fixtures 和 Component Gallery 为 UI 开发提供无 Server 环境。
- P0 开发从一开始覆盖 Client 错误映射、View Controller 状态、Field Type 逻辑、Grid 键盘操作和 Obsidian Workspace View Smoke Test。

## 11. 测试

- Field Type 纯逻辑测试。
- View Controller 状态测试。
- InMemoryLoomTableClient UI 测试。
- OpenAPI Fixtures 解码和生成类型漂移测试。
- Client HTTP 状态、错误码、Request ID 和重试映射测试。
- 同一 Record FIFO、不同 Record 并行和 Conflict 暂停队列测试。
- Grid 键盘和编辑测试。
- 真实 Obsidian Workspace View Smoke Test。
- Light/Dark、桌面/平板/手机布局测试。
- 20k 数据量虚拟化和滚动基准测试。
- Provider Schema、URL/Origin 校验、Credential 脱敏和缺少配置状态测试。
- Leaflet 生命周期、Provider 切换、OSM/天地图预设与发布前 Desktop/Android/iOS Live Smoke Test。

## 12. 后续字段和查询扩展

P0 只注册并实现 Text、LongText、Number、Checkbox、Date、Select、MultiSelect、URL 和 Location。Field Registry 必须允许后续增加以下能力，但不能在 P0 通过自由 JSON 或字符串约定提前伪装实现：

- `Region`：独立字段，使用 Server 提供的版本化层级目录和稳定 Region Code；不作为 Location 配置或层级 Select。
- `DateTime`：UTC 时间点，支持单值和范围。
- `Time`：不带日期的本地时刻，支持单值和范围。
- Location 的 `GeoWithin`：由 Server 执行矩形或圆形范围查询，后续再支持 Polygon。
- Text 的区域化 Validation Preset，例如手机号和身份证号。
- Number 的 Currency、Percent 只作为格式配置；Rating、Duration、User 等独立语义类型后续评估。

Filter Builder 已支持递归 `AND`/`OR` Group；每个 Group 至少一个子节点，最大深度为 8。Search 只针对 Primary Field、Text、LongText 和 URL 执行服务端不区分大小写的包含匹配。

## 13. Map View 与 Tile Provider

- Map View 由用户显式创建；P0 默认 Renderer 是随包发布的 Leaflet。
- 首次安装默认选择 `osm-standard`；内置预设还包括天地图矢量、影像和地形，以及 Custom XYZ 配置档。
- Provider 选择、Profile 和 Credential 是 Plugin 本地配置，不加入 Server `MapViewConfig`；Server 保存 `locationFieldId`、`filter`、`center` 和 `zoom`。
- 天地图只使用用户自己的 Token；默认会话保存，显式“记住凭据”后值写入 Obsidian SecretStorage，Plugin Data 只保存 Secret ID 引用。
- `center + zoom` 是用户显式保存的 Default Camera；普通平移和缩放只改变当前实例的临时相机，不产生 View Mutation。
- Map View 创建必须选择 Active Location Field；没有可选 Field 时禁用创建。Field 后续不可用时进入配置修复状态，不自动选择替代 Field。
- Map 数据通过 `POST /v1/views/{viewId}/map/query` 提交一个或两个不跨反经线的 WGS 84 Box、Zoom 和 CSS Pixel 尺寸。Server 使用已保存的 Location Field/Filter，自适应聚类并返回最多 500 个完整代表视口结果的 Point/Cluster。
- Point 只含 Record ID、坐标和 Primary Field 文本，详情按 ID 直查；可展开 Cluster 适配 Bounds，终端 Cluster 使用短期 Token 游标分页。Cluster 不持久化。
- Summary 对全部匹配 Active Record 返回精确互斥计数和 Data Bounds；缺失/无效坐标属于未定位，合法但超出 EPSG:3857 纬度的坐标保留原值并属于不可渲染。
- 同 Leaf 恢复临时相机；新 Leaf 使用 Default Camera → Data Bounds → 世界视图。Filter/数据刷新保留临时相机，只有显式“适配全部结果”才自动定位。
- P0 的 Location 使用 WGS 84 经纬度，瓦片只支持 EPSG:3857；不隐式转换 GCJ-02 或 BD-09。
- OSM 不允许批量预取或离线下载；任何 Provider 的 Attribution 都必须始终可见。
- Provider 故障不改变 LoomTable 数据连接状态，也不静默切换到其他外部服务。

详细的类型、模块边界、预设模板、自定义配置、安全与测试合同见 [Map View 与瓦片提供方规范](../ui/map-spec.md)。
# Plugin Client Interface

## 目的

`LoomTableClient` 是 Obsidian Plugin 与 LoomTable Server 之间的深模块 Interface。它隐藏 HTTP、认证、分页、重试、错误映射和响应解码，使 UI 只处理领域结果。

这不是一个通用数据库接口，也不承诺兼容其他后端。

## Client Interface

```ts
interface LoomTableClient {
  getMeta(): Promise<ServerMeta>;
  checkConnection(): Promise<ConnectionCheckResult>;
  listWorkspaces(): Promise<readonly Workspace[]>;
  listBases(workspaceId: string): Promise<readonly Base[]>;
  listTables(baseId: string, options?: ResourceListOptions): Promise<readonly Table[]>;
  listFields(tableId: string, options?: ResourceListOptions): Promise<readonly Field[]>;
  listViews(tableId: string, options?: ResourceListOptions): Promise<readonly View[]>;
  initializeAttachment(
    request: InitializeAttachmentRequest,
    idempotencyKey: string,
  ): Promise<Attachment>;
  getAttachment(attachmentId: string): Promise<Attachment>;
  deleteAttachment(attachmentId: string, expectedRevision: number): Promise<void>;
  uploadAttachmentContent(
    attachmentId: string,
    bytes: ArrayBuffer,
    contentType?: string,
  ): Promise<Attachment>;
  downloadAttachmentContent(attachmentId: string): Promise<AttachmentDownload>;
  query(request: QueryRequest): Promise<QueryResult>;
  queryMap(request: MapQueryRequest): Promise<MapQueryResult>;
  queryMapSummary(request: MapSummaryRequest): Promise<MapSummaryResult>;
  queryMapClusterRecords(request: MapClusterRecordsQueryRequest): Promise<QueryResult>;
  getRecord(recordId: string): Promise<Record>;
  mutate(request: MutationRequest): Promise<MutationResult>;
  pullChanges(request: ChangeRequest): Promise<ChangePage>;
}
```

只读 Grid 使用的 `QueryRequest` 将路由所需的 `tableId` 与 Server 的请求体字段分开；Client Adapter 只把请求体中的 `viewId`、`projection`、`filter`、`sort`、`search`、`limit` 和不透明 `cursor` 发送到
`POST /v1/tables/{tableId}/records/query`。`QueryResult` 必须保留 `items`、`hasMore`、`changeCursor`，并在首个页面保留 `totalCount`；当 `hasMore` 为真时必须有 `nextCursor`，否则不得接受该响应。

当前 `feature/grid-readonly` 垂直切片只读地呈现返回的 Record。Workspace → Base → Table → Grid View 导航由 View Controller 驱动，Filter、Sort 和 Cursor 继续由 Server 执行；Plugin 不在缓存页上重算查询语义。编辑、Mutation Queue 和 Conflict UI 属于后续切片。

`checkConnection()` 是只读连接探测：先请求公开的 `/v1/meta` 判断 API 版本、最低 Plugin 版本和迁移状态；兼容后再以当前 Token 请求 `/v1/workspaces`，区分缺少 Token、认证失败、权限不足、网络不可达与 Server 故障。该探测不创建或修改任何 Server 数据。

资源发现方法只执行认证后的 GET 请求，并返回 Plugin 领域类型；它们不把 OpenAPI 生成类型泄漏给 UI。列表顺序由 Server 合同定义并保持不变。`listTables`、`listFields` 和 `listViews` 接受可选的 `active`、`deleted` 或 `all` 生命周期范围；缺省值由 Server 采用 `active`。

Schema、Workspace、Base、Table、View 和 Attachment 的管理操作也通过同一 Client 的领域方法分组暴露，但不把底层 HTTP 请求透传到组件。Attachment P1 的 Managed 内容使用初始化、二进制上传和内容下载三段式边界；Vault Attachment 只初始化元数据，不通过 Server 读写 Vault 内容。

## 必须遵守的 Interface 事实

- `query` 使用服务端筛选、排序、分组和游标分页。
- `query` 返回查询快照的 `changeCursor`，供后续增量刷新使用。
- `queryMap` 使用服务端视口查询，返回最多 500 个完整代表视口结果的 Map Point/Map Cluster 与 `changeCursor`；它不通过普通 Record Cursor 下载完整匹配数据集。
- `queryMapSummary` 通过独立端点返回精确全局 Summary 和 Data Bounds；首次打开、保存的 Filter 改变或用户显式“适配全部结果”时调用，普通相机移动不调用。
- Map Point 只含 Record ID、坐标和 Primary Field 文本；`getRecord` 按需加载详情。`queryMapClusterRecords` 只消费 Map Query 返回的短期 Token，Token/Cursor 过期后刷新视口。
- `mutate` 必须携带 `clientMutationId`。
- 更新 Record 时必须携带 `expectedRevision`。
- 版本过期时返回可识别的 Conflict，而不是静默覆盖。
- `pullChanges` 只返回游标之后的 Change，并返回新的游标。
- P1 的 `getMeta()` 可以声明 `attachments` capability；Plugin 只在该能力已声明时展示 Attachment 入口。`501 CAPABILITY_NOT_ENABLED` 必须映射为独立的能力不可用状态，不能当作普通资源不存在。
- 认证失败、版本不兼容、服务不可用和数据冲突必须映射为不同错误类型。
- 网络重试不能导致 Mutation 重复应用。

## OpenAPI 类型边界

`LoomTable Server/docs/api/openapi.yaml` 是传输合同的唯一来源。Plugin 仓库保存一份明确版本的 OpenAPI 快照，并通过脚本生成 TypeScript Transport Types。生成文件不得手工修改；CI 必须重新生成并检查工作区是否产生差异，以阻止合同漂移。

UI 和领域模块不直接依赖生成类型。Client Adapter 负责在生成的 Transport Types 与 Plugin Domain Types 之间转换，使 OpenAPI 的传输细节不会扩散到 Grid、Map 和 Field Editor。

P0 的 View、CreateViewRequest 和 UpdateViewRequest 是以 `type` 为判别字段的 Grid/Map 联合类型。View Config 更新是带 `expectedRevision` 的完整替换，不是任意 JSON Patch；P0 不支持改变既有 View Type。

## Token 和传输安全

- 新建 Connection Profile 默认使用 Server 原生本地地址 `http://127.0.0.1:31201`；已有 Profile 的地址保持不变。

- Token 默认只保存在当前 Obsidian 会话的内存中，退出或重新加载 Plugin 后清除。
- P0 的最低 Obsidian 版本是 `1.11.5`，持久化密钥统一使用 `app.secretStorage`；不存在把明文 Token 写入 Plugin Data 的兼容回退。
- 连接设置使用 Obsidian `SecretComponent` 提供“记住 Token”：用户选择或创建可共享的 SecretStorage 条目，Plugin Data 只保存 Secret ID 引用，Plugin 不声明该 Secret 本体的独占所有权。
- 关闭“记住 Token”时立即删除 Plugin Data 中的绑定，但保留当前会话值直到断开或 Plugin 卸载；“断开连接”同时清除会话值。Secret 本体由用户在 Obsidian 的 Secret 管理界面管理，Plugin 不擅自覆盖或删除。
- 读取 Secret 失败、引用不存在或值为空时，连接进入 `authentication-required`，要求用户重新输入；不得回退到 Plugin Data 明文保存。
- Client 使用 Obsidian 官方 HTTP 能力，不允许 Grid、Map 或其他 UI 模块直接调用 `fetch`。
- 回环地址可以使用 HTTP；非回环 Server 必须使用 HTTPS。Client 不允许把认证请求跨 Origin 重定向。
- 所有请求必须配置调用级超时。View 销毁、切换 Server 或 Plugin 卸载时执行逻辑取消：调用方立即停止等待并使响应失效；Obsidian `requestUrl` 当前不提供 `AbortSignal`，因此不承诺终止已经发出的底层传输。

## 错误模型

Client Adapter 将 HTTP 和传输失败映射为可判别错误联合类型：

```ts
type LoomTableClientError =
  | AuthError
  | ForbiddenError
  | ValidationError
  | ConfigurationRequiredError
  | NotFoundError
  | ConflictError
  | CursorExpiredError
  | CapabilityError
  | ServerIncompatibleError
  | NetworkError
  | ServerError
  | AbortError;

interface LoomTableErrorBase {
  kind: string;
  message: string;
  code?: string;
  httpStatus?: number;
  requestId?: string;
  details?: unknown;
}
```

`ConflictError` 还必须保留 `clientMutationId`、失败 Command 索引、当前 Revision、服务端当前值和客户端提交值。`CursorExpiredError` 使当前 Query 丢弃旧 Cursor 并从第一页重新加载。`ServerIncompatibleError` 覆盖 API 版本不兼容和 `MIGRATION_REQUIRED`，必须阻止业务读写。`AbortError` 表示调用级逻辑取消，不显示为 Server 故障；它不声称底层 `requestUrl` 已被网络级中止。

`ConfigurationRequiredError` 映射 `422 VIEW_CONFIGURATION_REQUIRED`。Map View 用它进入 Location Field 修复状态；它不能与 Tile Provider/Credential 的本地 `configuration-required` 混为网络错误。

## 重试合同

- `getMeta`、查询和 Change 拉取遇到网络错误、`408`、`429`、`502`、`503` 或 `504` 时最多自动重试两次。
- Mutation 只有在请求已经携带稳定 `clientMutationId` 时，才可以对同一请求体执行相同的有限重试；每次重试必须复用原 `clientMutationId`。
- `400`、`401`、`403`、`404`、`409`、`410`、`422` 和 `501` 不自动重试。
- `503 MIGRATION_REQUIRED` 不自动重试；它进入 Server 不兼容/未就绪状态。临时依赖故障可以按上述有限策略重试。
- 响应带 `Retry-After` 时遵守该值，否则使用带抖动的退避。主动取消后不得重试。
- 逻辑取消或超时后，底层 Promise 的最终成功/失败都必须被安全消费并丢弃，不能形成未处理拒绝、写入缓存或覆盖新状态。

## Adapter

```text
LoomTableClient Interface
├── HttpLoomTableClient（生产）
└── InMemoryLoomTableClient（测试和 UI 预览）
```

`HttpLoomTableClient` 负责：

- Bearer Token。
- API 版本检查。
- 超时和有限重试。
- JSON 解码。
- 错误码映射。
- 调用级超时、逻辑取消和迟到响应丢弃。

Grid、Map、Field Editor 和 Component Gallery 不应自行使用 `fetch` 或拼接 API URL。

## OpenAPI 来源

Plugin 仓库提交 `openapi/loomtable-server.openapi.yaml` 和 `src/generated/transport.ts`，并在 `openapi/source.json` 记录来源 Server 的完整 Commit SHA。`api:sync` 负责显式下载指定提交，`api:generate` 负责生成 Transport Types，CI 拒绝生成结果漂移。日常安装、构建和测试不依赖同级 Server 工作树，也不访问网络获取 API 合同。

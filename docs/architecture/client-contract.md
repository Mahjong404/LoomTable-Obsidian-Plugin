# Plugin Client Interface

## 目的

`LoomTableClient` 是 Obsidian Plugin 与 LoomTable Server 之间的深模块 Interface。它隐藏 HTTP、认证、分页、重试、错误映射和响应解码，使 UI 只处理领域结果。

这不是一个通用数据库接口，也不承诺兼容其他后端。

## Interface 草案

```ts
interface LoomTableClient {
  getMeta(): Promise<ServerMeta>;
  query(request: QueryRequest): Promise<QueryResult>;
  mutate(request: MutationRequest): Promise<MutationResult>;
  pullChanges(request: ChangeRequest): Promise<ChangePage>;
}
```

Schema、Workspace、Base、Table、View 和 Attachment 的管理操作也通过同一 Client 的领域方法分组暴露，但不把底层 HTTP 请求透传到组件。

## 必须遵守的 Interface 事实

- `query` 使用服务端筛选、排序、分组和游标分页。
- `query` 返回查询快照的 `changeCursor`，供后续增量刷新使用。
- `mutate` 必须携带 `clientMutationId`。
- 更新 Record 时必须携带 `expectedRevision`。
- 版本过期时返回可识别的 Conflict，而不是静默覆盖。
- `pullChanges` 只返回游标之后的 Change，并返回新的游标。
- 认证失败、版本不兼容、服务不可用和数据冲突必须映射为不同错误类型。
- 网络重试不能导致 Mutation 重复应用。

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
- 请求取消。

Grid、Map、Field Editor 和 Component Gallery 不应自行使用 `fetch` 或拼接 API URL。


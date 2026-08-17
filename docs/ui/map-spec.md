# Map View 与瓦片提供方规范

## 1. 范围和已确定决策

P0 提供 LoomTable 自己的 Map View，不依赖用户安装其他 Obsidian 地图插件。

- Table 创建时只自动创建 Grid View；Map View 由用户显式创建。
- P0 内置并打包 Leaflet 作为地图渲染器。
- P0 使用栅格瓦片；只有出现明确的矢量样式需求后才评估 MapLibre。
- P0 内置 OpenStreetMap Standard、天地图矢量、天地图影像和天地图地形预设，并支持 Custom XYZ 配置档。
- OpenStreetMap Standard 是首次安装的默认瓦片提供方；Plugin 不根据 IP、系统语言或地图中心自动切换提供方。
- 地图渲染器、瓦片提供方和地理编码是三个独立边界。切换底图不得改变 Location 值，也不得触发地理编码。

本文中的 Provider 均指 **Tile Provider（瓦片提供方）**。`LocationValue.provider` 如果存在，只记录地点数据或地理编码的来源，不用于选择底图。

## 2. 数据与配置所有权

Server 的 `MapViewConfig` 保存可以跨客户端共享的 LoomTable View 配置：

```ts
interface MapViewConfig {
  locationFieldId: string;
  filter?: FilterNode;
  // 两者同时存在时表示显式保存的 Default Camera。
  center?: { lat: number; lng: number };
  zoom?: number;
}
```

瓦片提供方属于客户端运行环境，不加入 Server 的 View Config：

- `locationFieldId`、`filter` 和可选的 Default Camera `center + zoom` 由 Server 保存并使用 View Revision 进行并发控制；Filter 由 Server 按共享的递归 `AND`/`OR` 合同执行。
- 新建 Map View 必须从当前 Table 的 Active Location Field 中选择一个；没有可选 Field 时禁用创建并提供“新建地点字段”入口。已选 Field 后续被删除或不可用时，View 进入 `configuration-required`，要求用户明确重选，不能静默绑定另一个 Field。
- 普通平移、缩放和当前视口是每个 Map View 实例的临时状态，不自动写回 Server。只有用户执行“将当前位置设为默认”时，才完整替换 Map Config 并更新 View Revision。
- 默认瓦片提供方、每个 View 的本地覆盖、自定义配置档和 Credential 引用保存在 Plugin Data。
- Credential 值默认只保存在当前会话内存；用户明确启用“记住凭据”后写入 Obsidian SecretStorage，Plugin Data 仍只保存 Secret ID 引用。
- Provider 配置不会进入 Record、Location、OpenAPI Mutation 或 LoomTable Server 日志。

这样，同一个 Map View 可以在不同设备使用不同的合规瓦片服务；没有本地可用配置时，客户端显示“需要配置瓦片提供方”，不得静默改用另一个外部服务。

## 3. 模块边界

```text
views/map/MapViewController
├── LoomTableClient                 Record 与 View 数据
├── TileProviderRegistry            Provider 配置解析和校验
├── TileCredentialStore             Credential 生命周期
└── MapRenderer
    └── LeafletMapRenderer          P0 唯一生产实现
```

建议的代码结构：

```text
src/
├── views/map/
│   ├── map-view-controller.ts
│   ├── map-view-model.ts
│   └── map-view.ts
└── maps/
    ├── renderer/
    │   ├── map-renderer.ts
    │   └── leaflet-map-renderer.ts
    ├── providers/
    │   ├── tile-provider-registry.ts
    │   ├── tile-provider-schema.ts
    │   └── presets.ts
    └── credentials/
        └── tile-credential-store.ts
```

Map View 不识别 OSM、天地图或 URL 模板细节；Leaflet Adapter 不读取 Plugin Settings；Provider Registry 不操作 DOM。

## 4. Map Renderer Interface

```ts
interface MapRenderer {
  mount(container: HTMLElement, listener: MapEventListener): void;
  setTilePlan(plan: ResolvedTilePlan): void;
  setCamera(camera: MapCamera): void;
  fitBounds(bounds: MapViewport): void;
  setFeatures(features: readonly (MapPoint | MapCluster)[]): void;
  invalidateSize(): void;
  destroy(): void;
}
```

约束：

- `mount` 和 `destroy` 每个实例各调用一次。
- `setTilePlan` 负责原子替换基础图层、注记层和 Attribution；不得短暂混合两个 Provider。
- `fitBounds` 由 Renderer 根据容器尺寸和当前 Tile Plan 计算相机；双 Box 的反经线范围选择跨反经线的最短可见跨度。Controller 不复制 Leaflet 投影或 Padding 算法。
- Map Point 身份使用 Record ID。更新相同 Record 时复用 Marker，不销毁并重建整张地图；Map Cluster 不是 Record，不能进入 Field Editor。
- 用户平移或缩放产生 `cameraChanged` 事件；Controller 只更新实例临时视口并防抖触发新的服务端视口查询，不提交 View Mutation。
- Marker 点击产生 `recordSelected(recordId)`；Controller 随后按 Record ID 直查完整 Record 并打开详情，记录编辑继续经过 Field Editor 和标准 Mutation 流程。
- Cluster 点击产生 `clusterSelected(clusterId)`。存在不高于当前 Renderer/Provider 最大 Zoom 的 `expansionZoom` 时适配 Cluster Bounds；否则使用短期 `recordsQueryToken` 打开游标分页 Record 列表。Cluster ID 和 Token 都不能写入 Plugin Data 或 Leaf State。
- P0 不通过拖拽 Marker 直接修改 Location，避免绕过字段校验和 Conflict 处理。

Leaflet 是打包进 Plugin 的依赖，不是外部 Obsidian Plugin。依赖版本和许可证通知由仓库锁文件与第三方清单管理。

## 5. Tile Provider Interface

### 稳定引用

```ts
type BuiltInTileProviderId =
  | "osm-standard"
  | "tianditu-vector"
  | "tianditu-imagery"
  | "tianditu-terrain";

type TileProviderRef =
  | { kind: "built-in"; id: BuiltInTileProviderId }
  | { kind: "custom"; profileId: string };
```

View 和 Settings 只保存引用，不保存已经展开的带 Token URL。

### Provider 定义

```ts
interface TileProviderDefinition {
  schemaVersion: 1;
  id: string;
  displayName: string;
  protocol: "xyz" | "wmts-template";
  crs: "EPSG:3857";
  layers: readonly TileLayerTemplate[];
  minZoom: number;
  maxZoom: number;
  attribution: readonly TileAttribution[];
  usagePolicyUrl?: string;
  allowedOrigins: readonly string[];
  credentialSlots?: readonly TileCredentialSlot[];
  offlinePolicy: "forbidden" | "provider-defined";
}

interface TileLayerTemplate {
  id: string;
  role: "base" | "labels";
  urlTemplate: string;
  subdomains?: readonly string[];
  tileSize?: number;
}

interface TileAttribution {
  label: string;
  url?: string;
  licenseUrl?: string;
}

interface TileCredentialSlot {
  id: string;
  displayName: string;
  required: boolean;
}
```

Provider Registry 是深模块，只向 Map View 暴露列表和解析：

```ts
interface TileProviderRegistry {
  list(): readonly TileProviderSummary[];
  resolve(
    ref: TileProviderRef,
    credentials: TileCredentialReader,
  ): TileProviderResolution;
}

type TileProviderResolution =
  | { ok: true; plan: ResolvedTilePlan }
  | { ok: false; error: TileProviderError };
```

`ResolvedTilePlan` 可以在内存中短暂包含已展开 Credential，但它不可序列化、不可进入诊断对象，也不可被日志打印。Map View 不获得原始 Credential。

P0 不发布供第三方 Plugin 调用的公共 JavaScript API。新增普通服务商时优先增加一个受类型和测试保护的 Provider Definition；只有新的协议、签名算法或坐标系确实无法由现有定义表达时，才增加新的 Adapter。

## 6. 内置 Provider 预设

内置预设位于版本控制中的 `src/maps/providers/presets.ts`。它是实现数据而不是跨版本公共 API，因此服务商修改域名、参数或政策时可以随 Plugin 补丁版本更新。

| Preset ID | 图层 | Credential | P0 说明 |
|---|---|---|---|
| `osm-standard` | OpenStreetMap Standard | 无 | 首次安装默认；仅交互浏览 |
| `tianditu-vector` | `vec_w` + `cva_w` 注记 | 与其他天地图预设共用一个用户 Token | Web Mercator |
| `tianditu-imagery` | `img_w` + `cia_w` 注记 | 与其他天地图预设共用一个用户 Token | Web Mercator |
| `tianditu-terrain` | `ter_w` + `cta_w` 注记 | 与其他天地图预设共用一个用户 Token | Web Mercator |

### OpenStreetMap Standard

初始 URL 模板：

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

必须遵守：

- 地图角落始终显示可点击的 `© OpenStreetMap contributors` 和 ODbL 链接。
- 不提供区域预下载、离线包、后台预取或跨缩放级别批量抓取。
- 使用浏览器/WebView 正常缓存并遵守服务端 Cache Header；不得默认发送绕过缓存的 Header。
- 桌面端和移动端发布前都要验证请求身份、Referrer/平台行为、缓存和 Attribution。
- 该公共服务没有 SLA；故障时显示 Provider 错误，不把 Server 或 Location 标记为故障。

### 天地图

天地图三个内置预设共用一个用户 Token，Plugin 不附带共享 Token。由于 Plugin 在 `app://obsidian.md` Origin 下直接请求瓦片，必须使用天地图“浏览器端”应用 Key。标准 WMTS `tk` 请求只需要 Token，不需要安全密钥；不要把任何真实 Key 写入仓库、文档、测试或日志。初始 WMTS 模板由 Provider Definition 生成，等价于：

```text
https://t{s}.tianditu.gov.cn/{layer}_w/wmts
  ?SERVICE=WMTS
  &REQUEST=GetTile
  &VERSION=1.0.0
  &LAYER={layer}
  &STYLE=default
  &TILEMATRIXSET=w
  &FORMAT=tiles
  &TILEMATRIX={z}
  &TILEROW={y}
  &TILECOL={x}
  &tk={credential:tianditu-token}
```

其中 `{layer}` 由预设控制，三个预设使用同一个 `tianditu-token` Credential Placeholder；`{s}` 只能从预设允许的子域列表选择，Credential Placeholder 只在内存中展开。发布前使用用户提供的测试 Token 验证当前端点、权限、Zoom 范围、基础层与注记层组合、Attribution 和服务条款；预设端点不能被视为永久合同。

P0 只启用 `_w` Web Mercator 预设，不启用 `_c` 经纬度瓦片，也不在渲染过程中隐式切换 CRS。

### 其他知名服务商

MapTiler、Mapbox、Esri、CARTO、OpenTopoMap 等可以按相同 Registry 加入，但每个预设必须先独立核对 API Key、缓存、归因、商用、配额和离线政策。Google、Bing、高德和百度等不能仅因为存在可访问的瓦片 URL 就作为通用预设发布；需要使用获准的 API/SDK，并单独处理条款和坐标系。

## 7. Custom XYZ 配置档

P0 设置页允许创建 Custom XYZ 配置档。用户通过 UI 编辑，Plugin 以版本化 JSON 结构保存到 Plugin Data；不要求用户直接修改 `data.json`。

```ts
interface CustomTileProviderProfileV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  urlTemplate: string;
  subdomains?: string[];
  minZoom: number;
  maxZoom: number;
  tileSize: 256 | 512;
  attribution: TileAttribution[];
  credentialSlots?: TileCredentialSlot[];
}
```

校验规则：

- 必须包含 `{z}`、`{x}` 和 `{y}`；P0 不解析 WMTS Capabilities，也不执行任意 JavaScript。
- 非回环 Origin 必须使用 HTTPS；回环地址可以使用 HTTP，以支持自托管本地瓦片。
- URL 只能展开坐标、受限子域和声明过的 Credential Placeholder。
- Registry 从 URL Template 和 Subdomain 配置推导允许的 Origin；Credential 只能发送到该 Profile 的这些 Origin。
- `javascript:`、`data:`、`file:`、Vault 路径、任意 HTML Attribution 和未声明 Placeholder 一律拒绝。
- Attribution 至少包含一条纯文本来源；链接单独保存并由安全 DOM API 创建。
- 设置页提供“测试配置”，只请求当前视口的一张测试瓦片，不扫描范围。
- 自定义模板中的 `token`、`access_token`、`apiKey`、`key` 或 `tk` 等敏感参数不得写入字面值，必须改用 Credential Placeholder。

P0 的通用自定义能力只覆盖 XYZ。天地图所需的 WMTS KVP 模板由内置 Adapter 管理；通用 WMTS Capabilities、WMS 和矢量瓦片后置。

## 8. Plugin Settings 与 Credential

```ts
interface MapPresentationSettingsV1 {
  schemaVersion: 1;
  defaultProvider: TileProviderRef;
  perViewProvider: Record<string, TileProviderRef>;
  customProfiles: CustomTileProviderProfileV1[];
  // key 是 Provider/Profile 的 Credential Binding Key；value 只是 SecretStorage ID。
  credentialBindings: Record<string, string>;
}
```

`perViewProvider` 的键由完整 `LoomTableViewIdentity` 规范化生成，不能使用可变名称。删除 View 或连接后，Plugin 可以在设置页提供孤立覆盖清理，但不得自动删除仍可能被其他窗口使用的配置。

Credential 使用与 Server Token 相同的策略：

- 默认只在当前 Obsidian 会话内存中保存。
- “记住凭据”是逐 Credential 的显式选项，并使用 Obsidian `SecretComponent` 选择或创建可供其他 Plugin 引用的 SecretStorage 条目。
- P0 要求 Obsidian `1.11.5`；Plugin Data 只保存 Secret ID，不保存明文、编码值或可展开的 URL，Plugin 不声明 Secret 本体的独占所有权。
- 日志、错误、诊断导出和 `ResolvedTilePlan` 的可检查摘要必须对 Query Credential 进行脱敏。
- Secret 引用不存在、值为空或读取失败时返回 `configuration-required`，不得自动回退到无 Token 请求或 Plugin Data 明文。

Custom Profile 只保存 Credential Slot 和引用，不保存 Credential 值。用户关闭“记住凭据”时立即删除 Plugin Data 中的绑定，但保留当前会话值直到断开或 Plugin 卸载；断开时清除会话值。Secret 本体由用户在 Obsidian 的 Secret 管理界面管理，Plugin 不擅自覆盖或删除。

## 9. 坐标与地图语义

- P0 将 `Location.lat/lng` 解释为 WGS 84 经纬度。
- Leaflet 把 WGS 84 Marker 投影到 EPSG:3857 瓦片。
- P0 不对 Record 坐标执行隐式 GCJ-02、BD-09 或其他转换。
- Provider Definition 必须声明 CRS；P0 遇到非 EPSG:3857 Provider 时返回 `unsupported-crs`。
- 没有同时包含合法 `lat` 和 `lng` 的 Location 不创建 Marker，Map View 显示未定位记录数量。
- `MapViewConfig.filter` 命中的无效或缺失坐标 Record 计入未定位数量，但不创建 Marker。
- 合法 WGS 84 坐标超出 EPSG:3857 可渲染纬度 `±85.0511287798066` 时保留原 Location，但不创建 Marker，并单独计入不可渲染数量。
- Map Viewport 使用一个或两个不跨越反经线的 WGS 84 Box；跨反经线时拆为 `[-180, east]` 与 `[west, 180]` 两段，Controller 按 Record ID 去重接缝结果。
- 切换 Provider 只替换底图和 Attribution，不修改 Record、Map View 的中心点或 Marker 坐标。

## 10. Map 数据查询与相机

P0 不通过普通 Record Cursor 把全部匹配 Record 下载到 Plugin。Map View Controller 在相机稳定后调用 `POST /v1/views/{viewId}/map/query`，Body 只提交 Map Viewport、Zoom 和当前容器的 CSS Pixel 宽高。Server 校验 View、使用其已保存的 Location Field 和 Filter，不接受请求级字段或 Filter 覆盖。

传输合同以 Server OpenAPI 为准；Plugin Domain 侧至少保留以下约束：

```ts
interface MapPoint {
  kind: "point";
  recordId: string;
  position: MapCoordinate;
  primaryFieldText: string;
}

interface MapCluster {
  kind: "cluster";
  clusterId: string;              // 只在本次响应内协调 Renderer
  position: MapCoordinate;
  bounds: MapViewport;
  pointCount: number;
  expansionZoom?: number;
  recordsQueryToken: string;      // 短期、不透明、不可持久化
}
```

- 每次响应最多 500 个 Point/Cluster；Server 自适应聚类，Feature 必须完整代表当前 Map Viewport 内全部可渲染匹配 Record，Plugin 不接受“前 500 条”式静默截断。
- Point 只包含 Record ID、坐标和 Primary Field 显示文本；Popup/Marker 不预取自定义字段，打开详情时调用 `GET /v1/records/{recordId}`。
- 可展开 Cluster 点击后适配其 Bounds；相同坐标、已到最大 Zoom 或没有可用 `expansionZoom` 的终端 Cluster，通过 `POST /v1/views/{viewId}/map/cluster-records/query` 分页显示完整 Record。
- 独立 `POST /v1/views/{viewId}/map/summary` 对 Map View Filter 命中的全部 Active Record 返回精确的匹配、可渲染、未定位和不可渲染数量，以及全部可渲染结果的 Data Bounds。首次打开、保存的 Filter 改变或显式“适配全部结果”时调用，普通相机移动不调用。匹配数量必须等于三个互斥全局类别之和；Map Query 中 Point 数量加 Cluster 的 `pointCount` 必须等于当前视口可渲染数量。
- Map Query 返回 `changeCursor`。活动 View 收到 Record、Field 或 View Change 后保留临时相机并重查当前视口；不尝试用 Change 在客户端自行重算 Filter、Cluster 或 Summary。
- 每次相机稳定后逻辑取消前一笔仍在途的 Map Query，并用单调 Request Sequence 丢弃迟到响应；`requestUrl` 不承诺网络级中止，底层 Promise 的最终结果仍需安全消费。主动取消不显示为 Server 错误。View Revision 与当前已加载 View 不一致的响应也必须丢弃并刷新配置。

Default Camera 是共享 View Config，临时相机是单个 Plugin 窗口状态：

- 普通平移和缩放只改变临时相机。
- 用户执行“将当前位置设为默认”才使用 `expectedRevision` 完整替换 Map Config。
- 同一个 Obsidian Leaf 被保存并恢复时，从该 Leaf State 恢复临时相机；它不跨 Leaf、窗口或设备成为“上次相机”。
- 新 Leaf 首次打开时依次使用 Default Camera、全部可渲染匹配结果的 Data Bounds、世界视图；空数据时直接使用世界视图。
- Filter 或 Record 数据变化时保留当前临时相机并刷新当前视口；即使结果为空也不自动跳转。工具栏提供显式“适配全部结果”，使用最新 Data Bounds。
- 显式保存 Default Camera 后当前 Leaf 保持当前位置；其他新 Leaf 在下一次打开该 View 时才使用新的默认值。

## 11. 状态、失败和隐私

瓦片状态与 LoomTable 数据状态正交：缓存 Record 可以是 `offline + ready + readonly`，同时 Tile Provider 可以处于 `ready`、`loading`、`configuration-required` 或 `error`。

- 缺少天地图 Token：显示配置入口，不发送请求。
- Provider/Profile 不存在或配置无效：显示具体错误和“打开设置”，不静默回退。
- 瓦片网络失败：保留 Marker、记录列表和详情入口，并提供重试或显式切换 Provider。
- 基础层成功但注记层失败：显示图层降级提示，保留必须的 Attribution。
- 首次打开 Map View、发送任何瓦片请求前提示：外部瓦片服务能从请求的瓦片坐标推断当前查看范围，并适用其自己的隐私政策。确认状态只保存在本地；切换到尚未确认的 Provider/Profile 时再次提示。
- Tile Error 聚合后显示，不能为每一张失败瓦片弹出 Notice。
- `VIEW_CONFIGURATION_REQUIRED` 与 Tile Provider 的 `configuration-required` 分开呈现：前者要求重选 Location Field，后者要求配置 Provider/Credential；任何一方故障都不能被另一方的状态覆盖。

## 12. 验收和测试

### 不联网的自动测试

- Provider Schema、URL Placeholder、Origin、HTTPS 和 Attribution 校验。
- OSM 与三种天地图预设生成正确的基础层/注记层计划。
- Credential 缺失、会话保存、显式持久化、关闭持久化和日志脱敏。
- Provider 切换原子替换图层且不改变 Marker 坐标。
- 不支持 CRS、非法自定义 Profile 和丢失本地 Profile 的错误状态。
- Leaflet Adapter 的 mount/update/destroy 和 Obsidian Workspace View 生命周期。
- Renderer 的 `fitBounds` 覆盖单 Box、反经线双 Box、空 Bounds 与窄容器；Controller 不自行计算投影。
- 普通平移/缩放不产生 View Mutation；显式保存 Default Camera 使用完整 Config 和 `expectedRevision`。
- 同 Leaf 恢复临时相机，新 Leaf 按 Default Camera → Data Bounds → 世界视图回退；Filter/数据刷新不自动移动相机，“适配全部结果”显式移动。
- Map 查询只消费最多 500 个完整代表视口结果的 Point/Cluster；校验 Point/Cluster 数量不变量、精确 Summary 和反经线双 Box 去重。
- 快速连续平移时逻辑取消旧调用并丢弃迟到响应；验证底层 Promise 最终完成也不会产生未处理拒绝或写入缓存。View Revision 变化时不渲染旧配置结果。
- Point 点击按 ID 直查详情；终端 Cluster 使用短期 Token 游标分页，过期时刷新视口且不把 Cluster 当作 Record 编辑。
- 无 Location Field 时禁用创建；已配置 Field 被删除后进入 View 配置修复状态且不自动改选。
- 缺失/无效坐标与超出 EPSG:3857 纬度的合法坐标分别计入未定位和不可渲染数量。

### 发布前 Live Smoke Test

- Obsidian Desktop 已验证 OSM 加载、`Tiles ready`、Fit all 后的可渲染记录和可见 Attribution。
- Obsidian Desktop 的 `app://obsidian.md` Origin 已使用同一个浏览器端 Key 验证天地图矢量、影像、地形及相应注记层返回 200 PNG 并成功显示。
- Android、iOS Obsidian smoke 不在本次已通过范围内。
- 验证无 Token、无权限 Token、限流和 Provider 暂时不可用。
- 检查 Network/日志/诊断导出中不存在明文 Token。
- Live Test 不进入普通 CI 的必过链路，因为公共 Provider 无 SLA 且天地图需要私有 Token。

## 13. 官方参考

- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)
- [天地图 LBS 服务文档（Key 与权限）](https://lbs.tianditu.gov.cn/server/search2.html)
- [天地图 MapOptions（投影）](https://lbs.tianditu.gov.cn/api/js4.0/pages-class/MapOptions.html)
- [Obsidian `requestUrl` 类型定义](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)

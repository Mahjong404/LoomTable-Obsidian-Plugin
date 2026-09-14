# P1.5：Map 与 Location

本文件覆盖 M1/M2；数据和 Provider 的稳定规则继续遵守 [Map 规范](../ui/map-spec.md)。当前代码已有 Map Query/Summary、Marker、Cluster 分页和 shared Field Renderer；本期在这些实现上补齐用户操作。

## M1：真正的 Location 预览

### 入口与状态

- 有效 WGS 84 坐标在可渲染纬度 `±85.0511287798066` 内才挂载地图。纬度合法但超出此范围显示“不可渲染”，仍允许复制原坐标；缺失/无效成对坐标显示“未定位”，不伪造 (0,0)。
- Detail 坐标区域提供明确的“预览地图”按钮，键盘 Enter/Space、点击和触控均可触发。Ctrl（Windows/Linux）或 Cmd（macOS）+悬停是增强入口。
- 预览必须显示真实地图 renderer、当前坐标的一个 Marker、地点摘要和 Attribution；不能继续仅显示坐标文本，也不能用静态假地图代替生产接线。
- 不要求先创建 Map View 才能预览一个已知坐标。存在匹配 Map 时使用其本地 Provider 覆盖，否则使用当前 profile 的默认 Provider；不保存新的 View。
- 打开前复用既有 Provider 披露/确认流程；没有确认、缺少配置或 Credential 时不发送瓦片请求，显示现有确认或设置入口。不得因预览引入自动 Provider 回退。

### 生命周期逻辑

建立小型 preview controller/host seam，由 `LoomTableView` 注入 Renderer Factory、Provider resolution、已知坐标和打开 Map callback；`record-detail.ts` 不读取凭据或创建 Leaflet。

1. 状态为 closed → waiting → open（loading/ready/configuration-required/error/offline）；仅悬停路径使用 180ms 延迟，按钮立即打开。
2. Pointer 在坐标触发区域内且修饰键正确时启动定时器；释放键、离开触发区且未进入预览、切换 Record/Field、关闭 Detail、失焦窗口或卸载时撤销。
3. 触发器和浮层之间允许短暂移动宽限（150ms）；进入浮层则取消关闭定时器，让复制/打开动作可操作。hover 模式释放修饰键关闭；按钮模式保持打开直到关闭按钮、Escape、外部关闭或导航。
4. 每次打开分配递增 generation，最多一个预览实例。Provider 异步解析/宿主挂载返回时核对 generation 和身份；迟到结果不挂载，不写旧 DOM。
5. 复用现有 MapRenderer：mount 一次，setTilePlan、setCamera、setFeatures（仅该坐标），容器可见后 invalidateSize；初始 zoom 取 14 并限制到 Provider 支持范围。预览相机变化只影响预览实例。
6. 预览不调用 map/query、map/summary、records/mutate 或 updateView；已知单点来自当前 Record。只有用户“在地图中打开”后进入常规 Map 查询路径。
7. 关闭时清理 timers、document/keyboard/pointer listeners、resize observer、renderer；destroy 恰好一次。按钮模式打开焦点进入浮层，关闭回触发器；hover 模式不抢夺现有焦点。
8. 离线不发新的瓦片/Server 请求，展示坐标与离线说明；不要依赖浏览器离线缓存命中去主动联网。瓦片错误保留坐标、摘要和可用动作，不把 Record 标记损坏。

### 在 Map 中打开

匹配条件：同 Table、active、type=map、config.locationFieldId 等于该 Location Field；不能把任意 Map 都算匹配。

- 一个匹配项直接打开；多个匹配项弹出选择器，当前匹配 Map 可预选；按 ID 导航。
- 无匹配项时显示原因和显式“创建地图视图”入口，复用 V2 创建表单并预选 Location Field。取消不创建；创建成功后才打开。
- 打开时按完整 Record ID加载 Detail并设置临时相机，不改 Filter 或 Default Camera。被 Map 保存 Filter 排除的 Record 不可作为普通 Query Marker 强行插入；可以作为用户指定地点定位并展示 Detail，但不能声称它属于当前结果/计数。
- 使用已有完整 Record 或按 ID 获取，不通过全量下载寻找 Record。导航前保留既有 dirty guard；用户取消则预览/原界面保持。

## M2：Map 主界面与 Cluster

### 与 Table Shell 整合

- Grid 和 Map 使用 V1 同一 Shell。Map 的 Filter 使用 V3 同一 builder 和 V2 同一完整配置保存协调；Map 没有 Grid Sort/Projection/临时 Search 控件。
- 修改 filter/locationFieldId 后清理旧 Cluster token/分页，刷新 summary 和当前 viewport；保留临时相机。已保存 Default Camera 不因普通平移、切换 Provider 或 Record 更新改变。
- Field 失效使用 `VIEW_CONFIGURATION_REQUIRED` 与 brokenFieldIds，提供选择 active Location Field 的修复界面，用户确认后保存完整 config。无候选时说明原因；不自动选择，不顺带实现 Field 管理。
- 保存默认相机与 Filter 修改不能同时基于同一旧 revision 发两个 PATCH；按 V2 串行，失败和冲突保留意图。

### Point 与 Cluster

1. Point 点击按 recordId 获取完整 Record，复用同一 Detail、字段编辑、附件和生命周期 callback。不同请求乱序时只打开最后选择的 Record；销毁后回调无副作用。
2. Cluster 有合法 expansionZoom 且不超过 renderer/provider 最大值时 fitBounds；终端 Cluster 通过 `recordsQueryToken` 查询。禁止把 clusterId 当 recordId。
3. 列表主标题使用 Table.primaryFieldId 的共享 renderer 或“无标题”，不能以原始 ID/JSON 为主要展示；辅助摘要使用字段顺序的少量有值字段（最多 3 项），完整内容到 Detail。扩展现有 `clusterRecordLabel/Preview` 即可。
4. 保留当前 loading/empty/error/ready/pagination/close 状态，list/listitem 和可访问“打开记录”按钮；附件紧凑摘要不嵌套操作按钮，URL 独立链接不嵌在按钮中。
5. 同一 token 续页严格使用 Server 返回 cursor，保留 createdAt ASC、id ASC 顺序；一次一页，成功追加，失败保留已加载项。切换 Cluster、重查 viewport、View revision 改变或 Record Mutation 使旧 token、cursor 和请求失效。
6. 410 QUERY_SNAPSHOT_EXPIRED 后清空过期 Cluster 分页并刷新 viewport，提示用户重新选择；不能拿旧 token 从首屏重试循环。Cluster 失败不覆盖整张 Map 的数据状态。
7. 打开 Detail 后返回 Cluster 保留仍有效的列表位置和焦点；当前 Record 被删除/恢复或修改影响 token 时，按失效路径重新查询，不能继续展示声称有效的旧分页。

### 状态与资源

数据 Query、Summary、Tile、Cluster、Detail、Record Save、View Config Save 的状态独立。瓦片失败不阻止已有记录详情；401/403 指向连接/权限，Provider 配置错误指向设置，普通数据失败提供重试。Preview 与主 Map 都不得把 Provider Credential 放进 View config、Leaf state、诊断或日志。

Query 的 viewport/zoom/pixelWidth/pixelHeight 由现有 controller/renderer 提供，不复写投影算法；Point/Cluster 数量上限和全局 Summary 都由 Server 负责。Record Change 刷新相关数据，不能在客户端重算过滤/聚类。保持现有跨反经线、fitAll、View revision 和迟到响应防护。

## 自动化行为验证

通过假的 clock、Provider resolver 和 recording MapRenderer 验证生产 preview controller；至少覆盖：180ms 触发、释放修饰键、移入浮层、键盘/触控等价入口、快速换 Record、异步解析晚到、dispose、mount/destroy 对称、初始相机限制、无坐标/不可渲染坐标、离线零请求、未确认 Provider 零请求、瓦片错误保留内容。验证 preview 未调用 Mutation、Map Query 或 View 保存。

使用真实 Map View/controller + in-memory client 组合验证：零/一/多个匹配 Map、创建取消、同 ID 跨连接隔离、筛选后的目标 Record、Primary Field 不在字段数组首位、Cluster 多页/过期/乱序/关闭、生命周期失效和焦点返回。已有 Leaflet adapter 测试验证真实适配器方法调用；测试不访问公共瓦片服务。

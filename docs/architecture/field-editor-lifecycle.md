# Field Editor Lifecycle

此文档定义 Wave 1.5 编辑器的技术所有权和集成约束；不声明尚未创建的 TypeScript 接口已经存在。视觉见 [DS](../ui/design-system.md)，接受/取消行为见 [HIG](../ui/interaction-hig.md#datepicker)，任务和当前 API 门槛见 [Wave 1.5](../wave1.5/README.md)。

## 最小结构与依赖

继续使用 Native DOM/TypeScript/Obsidian、现有 Client/Controller/Mutation Queue。保留 native createEditor 的现有消费者；product editor 用一个窄 typed handle提供 element、read canonical value/snapshot、focus、owns event path/target、适用的接受/dismiss能力与dispose。精确名称由 W15-07/10 的生产实现确定，不用 DOM instanceof猜业务值。

Date 先用纯 date-only 逻辑与 Date-local state；Calendar factory 不依赖 Registry/Controller。native/Choice/Date 的保存时机由 consumer adapter定义，共享的是值/焦点/资源接缝。局部 Header/Footer helper可留在产品模块，定位 owner有实际复用需求时再提取；不预建未使用的通用 Picker framework或Time空壳。

拟新增 src/ui/date-only.ts（无DOM/时区）、date-picker.ts（DOM与本地状态）、choice-picker.ts（生产Choice）；它们在实际实现前都是拟新增，不写进 source-layout事实树。consumer/Registry可依赖factory，factory不反向 import consumer，避免循环依赖。

## 状态所有权

| Owner                          | 持有                                                                                                            | 不持有                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Date/Choice 产品 editor        | 原 value/presence、本地 candidate/raw/validity、display/preferredDay/view、gesture/overlay、接受 intent/promise | HTTP、mutation body/id、revision 重试或独立保存队列 |
| Persisted Grid/Detail adapter  | 原 profile/table/view/record/field/openEpoch、已接受 callback与当前恢复输入的挂载关系                           | 新 clientMutationId 或换 context 的 late publish    |
| Controller / Durable Queue     | 校验后的 mutation、权威 revision、乐观结果、immutable body/id、receipt/unknown/CAS/conflict                     | Calendar临时focus或UI导航                           |
| RecordCreate owner             | 已接受 local values/touched、outer Create intent及原context                                                     | 给未持久Record造ID/提前Update或option写入           |
| Query panel / View coordinator | Filter/Sort/Display local draft、validated intent、View CAS/失效query/cursor                                    | Record编辑的accept/Undo/成功协议                    |

## 接受与异步生命周期

1. 选择/浏览更新 editor本地状态；接受触发时先同步 claim一个 intent/promise，重复 Confirm/outside/Tab返回同一工作，不另发请求。
2. 先校验合法 canonical value与原 presence；未改无操作，Clear按真实业务语义为null/[]/undefined，不能通过空串替代。
3. 捕获原context并调用唯一promise-aware consumer callback。持久Record仍通过已有Controller/Queue；失败/unknown保持输入与操作身份，不先结束编辑器再报Saved。
4. UI取消/dispose取消未发intent、视觉工作与子overlay；已发工作继续归原operation。原owner失效后completion可以更新原队列/数据，但不能关闭新Form、重设新Current或抢外部focus。
5. 原context仍有效时按已有failed draft机制恢复输入；没有原context时不得复制到新表。不存在全局未接受picker草稿持久层。

## 持久化与 Draft 的接入

- Grid Date branch、Detail Date adapter去掉native change/blur旁路；onCellEdit/onFieldEdit返回权威Promise而非fire-and-forget。其他字段保持既有保存时机。
- Grid Draft/Form只在Date/Choice接受后更新values/touched；Date建议不触摸key。owned内部focus不触发row focusout Create；outer Submit必须处理有效本地值，invalid raw阻止所属Create并保输入，不能偷偷提交旧值。
- Map的真实RecordCreateForm、Detail取消/成功/render/destroy、View/Profile/context/Field/anchor失效都走同一窄dispose seam。只接Gallery不足以交付生产生命周期。
- Filter Calendar若复用，onAccept只更新query operand，Clear=undefined，继续validated debounce/View queue；不走RecordMutation或Undo。

## 资源与上下文守卫

一个 overlay owner登记trigger、所有owned child、close与return focus；composedPath内事件不当outside。捕获context/epoch校验成功和错误；child close、Field/operator删除、Rule reorder、新edit generation都失效旧callback。

dispose必须可重复，释放listener、timer/rAF、observer、capture、子overlay；晚transitionend/scrollend只清理旧资源，不重写值。Esc/显式关闭回有效trigger；外点/真正Tab离开/context切换尊重用户新focus。anchor因virtualization失效按原owner策略保存/取消未发UI，不能生成第二次Mutation。

## 数据与错误边界

Date-only只用Gregorian YYYY-MM-DD或null，presence另保；低年份校验不经默认Date.UTC映射，已有值不经timestamp转换。当前无通用required字段配置，UI不得从Figma推导Server政策。Time/DateTime是另外的Future字段合同。

未知结果由原Queue/body/id恢复；409沿原conflict机制，overwrite只有明确新用户意图才形成新Mutation。storage失败不得先HTTP；UI取消不更改已发请求identity。Schema/Queue格式升级仅在对应API Gate授权后做。

## 验证接缝

任务卡要求的Unit/DOM/Integration证明接受请求次数、无草稿提前持久化、originalpresence恢复、deferred失败/latecontext、重复dispose与资源清理。Gallery调用生产factory；Obsidian证明实际Focus/Popover/Sheet/Pointer与布局，Mobile证明真实touch/WebView。编译/jsdom不证明视觉几何或设备行为。

## Renderer 与 Query owner 释放顺序

Grid的Renderer是稳定的UI owner。LoomTableView在renderGrid替换、showMap、View/Profile/Table切换及disposeAll中，先capture允许保留的Grid工作session，再dispose旧Renderer及其子owner，最后清DOM/引用、销毁或替换Controller。不能仅把gridRenderer设null，也不能在Controller失效之后让Renderer的销毁回调继续发View写入。

Renderer只在owner仍有效时响应query dismiss；区分user-close、escape与context-switch/owner-dispose，按HIG的关闭原因表处理未发intent。FilterBuilder/SortPanel的资源dispose不触发onApply；in-flight finally在disposed/generation失效时只清理，丢弃未发queued apply，不递归调用旧owner。普通user-close的flush由有效consumer显式执行并await/串行claim。

生产接缝：FilterBuilder、SortPanel、DisplayPanel导出`flushPendingApply(): Promise<void>`与幂等`dispose(): void`。前者仅由有效consumer在user-close调用，串行等待已接受工作及最后有效queued draft；后者只取消未接受UI工作。ReadonlyGridRenderer的`closeQueryPanels(reason)`接收`user-close | escape | context-switch`，普通关闭保留失败raw draft供同context重开，另外两种销毁缓存。LoomTableView统一经`releaseGridRenderer()`先capture session再dispose；新Renderer或Map不复用旧owner。Controller已接受的工作不会被此接缝撤销。

所有Field/Values/Menu/Palette子owner登记一个幂等disposer。替换config/rows、virtualized anchor失效、ownerDOM脱离都要走disposer，而不只remove子DOM。Field的MutationObserver不能替代Renderer自身timer/document listener释放。Rendererdispose清理其Query/search debounce、document/capture listener、Menu与所有child；新Renderer不继承旧listener。

UI守卫不更改Controller/ViewWriteCoordinator/MutationQueue的持久合同：已发送的immutable operation继续归原数据context；不替换clientMutationId/body，不取消原receipt恢复，不在失效owner上启动新的intent。

这里的未发UI intent是尚未调用consumer callback的timer/queued draft。consumer已claim的Controller/View coordinator/Queue工作继续按原协议完成，即使transport尚未开始，也不能由overlay重写其身份或擅自撤回。销毁禁止的是旧UI继续启动新的callback，并隔离旧completion对新UI的发布；该定义不改变既有持久化合同。

## 同 View 几何替换与未接受输入

列宽、冻结列与密度变更不构成 Cell 接受意图。Record/Field/type 仍合法时，Renderer 在连接的新 viewport 中先恢复滚动锚点及虚拟窗口，再定位原编辑器；保留同一个原生输入节点、raw、selection/caret、focus 与 composition。支持原生 `moveBefore` 的宿主使用保持状态的移动；DOM fallback 的设备行为须单独验证。被动滚动后的编辑行可在正常虚拟窗口外额外保留一行，不全量挂载数据。Create Draft 同样不因几何重建触发 Create。

每次 View revision 更新都会使 Server cursor 失效。Controller 必须重新查询；查询成员与顺序不变的布局写入，先取足先前已加载数量再原子发布，不能暂时只发布第一页并使远处编辑器失效。后续页失败保留旧行并显示刷新错误；context/dispose 使迟到页失效且不再请求下一页。Filter/Sort/projection 等真实查询改变仍沿既有重查语义；Record/Field 删除、type 失效、Table/View 切换与 owner 销毁按原生命周期取消，不无限保留失效编辑器。此接缝不修改 Record mutation、CAS、Queue 或已接受操作身份。

后续页失败时不保留过期cursor；错误面板的Retry继续走既有`refresh()`，重新读取最新导航/Field/View。若最新查询（含Search、manualSort与View身份）仍相同，原子重取原加载数量后恢复新cursor与Load More；不能用只发布第一页的刷新再丢编辑窗口。若查询或context已改变，按新查询正常替换，不恢复旧前缀。重复失败仍保旧行及Retry，不能伪造hasMore或复用旧revision的cursor。

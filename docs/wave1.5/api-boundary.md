# Wave 1.5 — API Boundary

2026-10-12。本文是 **API 能力边界与待批准合同清单**，不定义已经可调用的新接口。实际传输合同唯一来源是 Server [OpenAPI](https://github.com/Mahjong404/LoomTable-Server/blob/main/docs/api/openapi.yaml) 与 Plugin 固定快照 [source.json](../../openapi/source.json)、[OpenAPI](../../openapi/loomtable-server.openapi.yaml) 和 [generated transport](../../src/generated/transport.ts)。

## 当前合同能支持的工作

源码审查基线：Plugin main@336db8c47a5bf52a63eb1a4a127002c43872cf1e；Server main@5f4827f6b7a7f189aac13e3bc3c0e92377a7873e。Plugin 固定 API commit 为 43da70e3c241380fff34d0deee8c1142ba39cb47。这些是审查基线，实施前读取真实 checkout；Server HEAD 更新不意味着 Plugin 应自动 sync。

| 能力                       | 已有事实                                                                                                        | 当前实施边界                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Date                       | date Field、EmptyFieldConfig；Gregorian YYYY-MM-DD string 或 null；set 与 unset 分开                            | DatePicker 替换 UI，无新 endpoint/时区/Required 配置；Calendar 选择不产生 Mutation          |
| Record Mutation            | Create/Update/Delete/Restore；expectedRevision、clientMutationId、receipt/replay 与既有队列                     | 通过 Client/Controller/Queue，保留原 body/id 与 unknown 处理；UI 关闭不撤回已发请求         |
| Choice                     | 现有 option ID，Select null、MultiSelect []；standalone Field options 更新；writer 9 色、reader color 为 string | 当前 ID 选择、搜索、清空、顺序和既有 9 色可开发；不两请求模拟 create-and-assign             |
| Query / Display            | Server Filter/Sort/Search/cursor/distinct、View config CAS 和列宽                                               | 当前 query 与布局可开发；Distinct 的 Search 不代表 Aggregate 也支持 Search                  |
| View                       | 当前导航、创建、复制、默认切换和重命名                                                                          | 没有 Table orderRevision/排序 CAS；新 tail 语义待 G3                                        |
| Selection                  | 当前 loaded IDs 与 Cell rectangle                                                                               | 不能声称 Header 已选择未加载 query membership；新 scope 待 G4                               |
| History / Deleted          | 现有历史、回收站、revision restore、local Undo                                                                  | 安全修复可做；完整 Table Audit/Record projection 待 G5，跨 session Table rollback 属 Future |
| Aggregate                  | AggregateRequest 当前仅 fields/filter，没有 Search                                                              | 当前 Footer/菜单可做；非空 Search 的匹配汇总在 G6 前明确不可用                              |
| Time / DateTime / Required | 当前没有 Time/DateTime Field union 或通用 required Field config                                                 | 视觉批准不允许向 Date 写 HH:mm 或自行添加字段持久化                                         |

## API-first 顺序与 Gate 的启用条件

1. 为**一个明确获授权的 Gate**冻结领域规则、请求/响应、错误、权限、revision、幂等、兼容性和 rollout；先审查 Server 规范与 OpenAPI 合同草案。
2. 基于批准合同实现 Server domain/validation/storage/HTTP，必要迁移单独说明；合同测试与专用隔离数据库的事务/并发验证通过。
3. 审查并合并 Server 合同与实现，记录完整 40 位 commit SHA、实际 capability/版本范围、部署可用性、测试与回滚依据。
4. Plugin 再显式 api:sync approvedSHA → api:generate，审查快照/generated diff；接入 decoder/client、InMemory、必要 Queue schema/Controller，然后启用真实消费者。
5. 验证旧 Plugin/新 Server、新 Plugin/旧 Server、混合 writer 与 capability 缺失；完成隔离联调和运行时 QA后逐项标 Done。

**合同批准、Server 合并和实际部署是不同状态。** Plugin 只接入明确交付的合同；生产新动作仍需能力检测/安全 fallback。单个 Gate 完成不解锁其他 Gate。没有授权时 Server、OpenAPI、API pin 和 generated 保持不变；可继续不依赖它的 Lane A。

Server 独立执行流程见 [Server docs/wave1.5/README.md](https://github.com/Mahjong404/LoomTable-Server/blob/main/docs/wave1.5/README.md)。统一审批与跨仓库发布引用见 [status.md](status.md)；Plugin 本地代码实施见 [devin-plugin.md](devin-plugin.md)。

## 六条 API Gate

以下 API 名称/结构为待评审方案，不是已存在的工具或 Schema。每条合同卡都需要明确：授权范围、必改模块、兼容/权限/失败、事务或只读语义、验收和回滚。Server 与 Plugin 各自以实际源码重新定位，不照抄行号。

### G1 — 12-color write compatibility

- 目标：允许已批准lime/indigo/brown写入，已有9色值不变，未知color reader仍安全保值/显示；CurrentReader字符串事实替代旧strict9误断言。
- 修改范围：Server`internal/catalog/service.go`/OpenAPI/fieldtypes；Plugininputcolorunion、Fieldpalette、Tagtheme、typedfakes/HTTPtests/pin；**纯加色没有自动DB迁移要求**，先查真实schema。
- Gate：reader-first/min-version/capability具体策略通过评审；验证支持旧版本读取fallback与再次保存config保留陌生color。未知Field/changeKind风险不能用color-string推断安全。
- 验收：12×Light/Dark对比，enum/decoder/保存/旧新Plugin×Server矩阵，disabledcapability；不伪宣CSS12即后端12。可独立于G2交付；回退关闭新色writer，已存值reader继续可读，不能删除旧数据。

### G2 — Atomic Choice Existing / Record Draft

- 目标：选项解析/必要创建+Record赋值或outerCreate同事务all-or-none；包括新Record无ID的Draft。
- Server真实模块：`internal/record/{model,service}.go`、postgres`record.go/field.go/catalog.go/convert.go`、catalognormalization、httpapi；审查actor→receipt→Table→Field→Record及现有Field/Convert不同锁序，统一必要writer边界并发验证。
- Plugin：client/decoder、mutation queue runtime/scheduler/settings持久schema、Registry/Choice/CreateDraft/Controller单调Fieldmerge。候选command如`createChoiceAndSetValue`/`createRecordWithChoices`只是本地建议，不能直接发。
- 必需合同：Field+Record revision、labelcanonical/duplicatecase、newoptionsbudget/rights、immutablebody/clientMutationId、replay-before-CAS、outcome applied/unchanged、boundedFielddelta/Recordresponse、exactoperationidentity；draft不提前持久化option、不临时假ID、不FieldPATCH+Record两请求替代。
- 验收：权限/双CAS/同名race/Fieldconvertlock/deadlock、任一failure零部分效果、stablekeyunknown/replay/no-op、store失败不HTTP、receipt到期不可换ID二次create、queue旧新格式升级。G1新色可后续，原子既有9色可先；recovery业务目标将来包括optiondelta完整回滚，不误称sessionassignment-onlyUndo为最终目标。
- DoD/批准：正式schema/兼容/隔离事务验证/rollout与failureavailability获批；只在此后解锁Choiceinlinecreate。需Plugin+Serverowner协作，UI Session不能单做。

### G3 — Table View order CAS / lifecycle tail

- 目标：完整activeViewpermutation + snapshotorderRevision，create/duplicate/restore尾部一次、delete保survivors、default不reorder；historyrollback另按真实历史order恢复。
- 范围：Serverdomain/catalog/postgresview/httpapi、必要position/orderrevisionmigration/backfill；PluginlistViewsDTO、ordercoordinator/intentsettings、Shellhandle、Controller/client/pin。
- Gate：同快照list/revision、max100/completepermutation、409/no-op/idempotentreplay、restoreoldcreatedAt与新tail行为、oldclient兼容和migrationrollback评审。Recordorder不是Vieworder。
- 验收：多client并发/duplicate/delete/restore/default、lostresponse/replay不二次append、invalidpermutation/跨Table、sameSnapshot；Plugin无localstorage orderfallback。当前Viewnavigation/rename不等此Gate；不自动新增ViewRecycleUI。

### G4 — Whole-query RowSelection scope

- 目标：Filter+Search完整Servermembership，未加载记录count/token/exclusions；Sort/display不改变成员，query/schema/membercontext失效先清scope；Current与Ctrl+A矩形独立。
- 范围：Serverrecordquery/storage/httpapi/model与必要scope/expiry机制；Pluginclient/GridController/selection reducer/renderer、contractpin。
- Gate：snapshot vslive语义、canonicalmembershipfingerprint/semanticdataVersion、expiry/权限/分页membership/跨Table拒绝；需要正式合同，普通30mincursor不等于selectionSnapshot。
- 验收：10000matching/loaded100 headercount10000；部分Unchecked无Mixed；Scope响应前query变更/lateerror、sort保持/search失效、expired/offline/revoked、emptydisabled。不得拉满Table或在loadedSet上伪造all；bulk写入不随selection批准，另有权限/preview/expiry/CAS合同才可做。

### G5 — Unified Table Audit + Record projection / exact association

- 目标：ALL Table事实统一（Record/Field/View/config/order等按已批准scope），Plugin只读取分页前Recorddata/lifecycleprojection；提供event-timeField/Optiontypeddisplay、presence、operation/changekey、applied/noop及actualavailability。
- 范围：Serverhistory/models/recordchangeinsertion/FieldViewConvertwriters/httpapi、版本化auditpayload必要迁移；PluginDTO/HTTPstrictdecoder、Activityadapter、Undoidentity/controller/pin。
- Gate：event-time记录vsread-time当前metadata区分、历史缺失显示未记录；category过滤在limit/cursor之前、projection/filter/cursor一体；newchangeKind旧reader兼容；exact响应change/operation association，不能靠time/title/index猜。
- 验收：mixField/View/Recordtimeline下Recordprojection连续页/计数正确；multiFieldevent映射稳定、no-op无假event、history410/actualretention、latecontext/appendguards；全Tablerollbackavailability不足真实disabled；无Actor/Profile要求。
- 实施层次：先读投影/metadata/identity合同与Server，再W15-08B真实入口。完整inverse/checkpoint/TableRecovery另Future，不为了当前历史浏览先重建整个rollbackengine；但不能暗称当前auditpayload已经可逆。

### G6 — Aggregate 与 Filter+Search query 同域

- 目标：Footer聚合与当前activeRecord Filter+Search范围一致；不是显示Filter-only或loadedpage和。
- 当前证据：Plugin`AggregateRequest`仅fields/filter；最初Server基线OpenAPI/Postgres无Search；最新固定f398已交付该能力，详见本文交付节。Distinct已有Search不能推导Aggregate也有。
- 范围：Serverrecordaggregate/request/validator/httpapi/postgresquery共享Search语义、OpenAPI；Pluginclient/HTTP/InMemory/controlleraggregationrequest/cache/pin；复用现有query normalization与read scope，不新建另套聚合引擎。
- Gate：作为窄正确性合同补齐独立评审，明确Searchtrim/空值/权限/active/filter口径、计数/number/date聚合和snapshot一致性；若需P1.6API修复例外由用户批准，不默许。
- 验收：Filter+Search/仅Search/空Search、Search变更lateaggregate不污染、rename/option搜索投影、sum/avg/count/min/max范围一致、oldServercapabilityfallback不误报；合成DB/HTTPfixtures。无capability时Searchactive数值真实unavailable，不假全scope。可独立于G4/其他Gate实施。

## Future — Time / DateTime / 12h

启动前必须批准 Time-only 与 DateTime 的领域场景、精度、合法范围（含 24:00/闰秒政策）、序列化、跨日、zone/DST、nullable/unset/空串、Field config/Required 来源、Filter/Sort/Aggregate/转换/审计与旧新版本兼容。Time-only 的 HH:mm/分钟精度/24h canonical 仅是候选；DateTime 必须明确 instant 或 wall-time+zone，不能用 UI 样例替代决定。

之后遵循 API-first：Server Field/value/config/query/存储/审计及必要迁移 → 固定 OpenAPI/生成类型/client → TimeDraft/Clock/Wheel/AMPM → Grid/Detail/Create 等真实消费者 → Runtime QA。TimeDraft 采用 hour 0–23/minute 0–59；12h 只是展示投影，不能保存第二个 period 值。12h 保留当前 Future 门槛。

已批准视觉只在 [DS Picker](../ui/design-system.md#picker-视觉合同) 维护，Clock/Wheel/AMPM 动态规则只在 [HIG Future TimePicker](../ui/interaction-hig.md#future-timepicker) 维护。正式制作 Figma 动画或扩展工具不属于任何实施前置。隔离 Gallery/纯逻辑样例只有后续明确授权才做，并标明不交付 Time/DateTime 业务能力。

## Future — 整 Table inclusive 回滚

已确定目标：选择目标操作时撤销该条及之后整个 Table 的操作，回到目标操作前；覆盖 Record、Field/options/config、View/default/order 和原子 Choice delta。默认 30d 方向已确定，读取日志窗口不等于可靠恢复窗口。

实施前合同必须定义 versioned operation/group/inverse、所有 writer 的 monotonic Table head、dependency closure/checkpoint/GC 与真实 earliestRestorable/barrier；先 synthetic replay/资源验证，再 preview impact、head/expiry/权限复核与确认、atomic publish、revision 单调、原 clientMutationId/body 的 unknown/replay。普通 View restore 的 tail 语义不能替代历史 order 恢复；缺失 inverse 的旧历史不可伪造可恢复。

验收涵盖跨 client/session、全 writer、无 ABA/死锁、权限/过期/容量、预览后 head 改变需重新预览、并发 maintenance、失败零部分恢复、保留旧历史并记录新 rollback、附件/外部资源边界。需要独立 Server 阶段与隔离测试环境；不作为 W15-08B 的前置，也不由 local Undo 模拟。

## Deferred 与安全测试环境

Avatar/Profile、Administrative Cascader、细粒度转换审计等不进入当前生产任务，不阻断 Date/Query/Grid。新增 bulk mutation、View 回收站 UI、二维剪贴板及新字段权限不由这些 Gate 自动授权。

Server 集成测试读取 LOOMTABLE_TEST_DATABASE_URL，执行 DROP SCHEMA public CASCADE。只允许专用、可销毁、使用合成数据的 CI/test 数据库；名字包含 test 仍不足以证明环境可重置。不默认在本机启动 Docker/PostgreSQL，不重置生产或长期共享环境。未具备环境就记录未验证，Plugin 可用 typed fixtures 验证，不宣称真实 Server 事务通过。

## 2026-10-12 固定 Server 交付与 Plugin 分界

以上“当前合同”表指Plugin pin43da70e3c241380fff34d0deee8c1142ba39cb47；不能再把它当作最新Server事实。G1和G6有已发布合同/实现/部署交接，Plugin本轮未sync、未改generated或consumer。

- G1 approved contract及源码47fc985bd9376dc761469b40fe40dcfd1ceb483e，merge173c2f031dd4acf0957a40afcb07e94125e8305f，[PR10](https://github.com/Mahjong404/LoomTable-Server/pull/10)。[固定G1合同](https://github.com/Mahjong404/LoomTable-Server/blob/47fc985bd9376dc761469b40fe40dcfd1ceb483e/docs/wave1.5/contracts/g1-choice-palette.md)：严格12色writer、reader保陌生string，choicePalette12 capability；Record仍Option ID，不解锁G2。旧writer含新色config resave会422，先reader/兼容再writer。
- G6 approved contract及源码f3980b1b4126cdfce026c0a94779c8c8261b3997（含G1），mergebf6237b7450af3ff3ca1ba9d0155c19096a352fb，[PR11](https://github.com/Mahjong404/LoomTable-Server/pull/11)。[固定G6合同](https://github.com/Mahjong404/LoomTable-Server/blob/f3980b1b4126cdfce026c0a94779c8c8261b3997/docs/wave1.5/contracts/g6-aggregate-search.md)：Aggregate可选search、aggregateSearch capability、Filter交集与Query同域；Unicode Trim→NFC→500码点→Default Case Folding，schema不以raw maxLength拒合法输入。单响应同快照，不保证独立Query/Aggregate跨请求固定快照；无Queue/revision/receipt变更。
- [固定发布证据](https://github.com/Mahjong404/LoomTable-Server/blob/bb00e6ad3d100a6e5e0879d1e8c1fb25ab51bfec/docs/wave1.5/deliveries/g6-aggregate-search.md)记录实际v0.4.0+f3980b1b4126、公开/内部Meta的choicePalette12/aggregateSearch、CI与恢复/回滚。部署验证来自Server工作线及该tracked交付；本Session没有再请求生产或写QA Record。

状态术语统一：既有UI使用Existing API Ready；新Gate依次为Contract Approved / Server Pending、Server Implemented / Not Deployed、Deployed / Capability Verified（注明验证来源）、Plugin Integration Ready（已显式pin/生成/consumer兼容通过）。G1/G6目前达到Server发布交付，**未达到Plugin Integration Ready**；G2–G5精确合同/实现仍按各自交付，产品方向不重选。

未来获授权的Plugin API接入用固定f3980b1b4126cdfce026c0a94779c8c8261b3997，api:sync→api:generate审查0.4.0 optional search/12-color enum/capability。HTTP、InMemory、Controller、aggregate cache/generation传同一Search，测试超过一页成员、null/0/Unicode/Filter交集与旧Server缺capability；connection/Profile/Table切换失效能力与晚响应。G1/G6消费者独立验收，不因一次pin含两者就全部启用；纯UI首批继续旧pin不变。

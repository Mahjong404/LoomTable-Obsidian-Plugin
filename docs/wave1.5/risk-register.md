# Wave 1.5 — Open Decisions and Risk Register

2026-10-12。设计已批准，00/01/02已有交付；本轮针对固定52b2c9d进行真实UI工程重校准。此表只记录重大合同门槛与可验证的工程风险。进度和审批引用统一在 [status.md](status.md)。

## 1. 设计与工程问题裁决

**Wave 1.5 Design Phase Complete — Ready for Engineering Planning / Implementation。**

| 问题                                                                                              | 分类与裁决                                            | 实施处理 / 验证                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Date三层选择、20年页、preferred day、Today/Clear/Confirm、Esc/outside/Tab                         | A 已明确                                              | 10/11按正式 HIG 合同实现；不补Figma动画                                                              |
| Date-only、null/unset/空字符串、Gregorian低年                                                     | A 已有领域合同，当前validator有工程bug                | pureDate修复与0000–0099/闰年/TZ测试；不改Field类型                                                   |
| Picker session是否公共框架                                                                        | B 工程判断                                            | 先Date-local状态+窄product handle；不先建picker-session/Time空壳                                     |
| Date/Time共享内容                                                                                 | B 当前只共享有效token/icon/overlay seam，Future另评估 | 不共享业务值、时区、commit或draft；第二真实产品出现后才提取验证过的helper                            |
| Header/Footer是否抽公共组件                                                                       | B 开发者可选                                          | 首先Date内helper；Calendar nav/Time mode不因Figma共享表面变公共行为类                                |
| Popover overlay owner                                                                             | B 架构清楚，D宿主验证                                 | 保现有context-menu pane定位；Date局部owned生命周期；需要时同切片提取定位helper，单body单owner        |
| async Grid保存/blur旁路                                                                           | 必须在10解决的工程接缝，不需产品重新决策              | promise-aware callback、sync intent claim、原Controller/context、Date不绑定native blur保存；竞态测试 |
| New Record Draft vs persisted Record                                                              | A 明确                                                | Date接受只local/touched；outerCreate唯一持久化；不fakeID、不提前option写入                           |
| Required视觉被当成Fieldconfig                                                                     | A 当前源码无业务policy                                | 生产Date可Clear；条件Gallery明确标样例；以后新增Required另合同，不为当前阻断                         |
| HIG旧行为与批准设计冲突                                                                           | W15-00 文档审查                                       | 核对正式 Date/操作入口/Current 规范，保 Query 自动更新                                               |
| UI误改Mutation语义                                                                                | A 固定Controller/Queue/transport                      | UI不直HTTP、不给leaf保存第二id/body/receipt；contract tests/pin零diff                                |
| Gallery是否真实同源                                                                               | D 对应切片验证                                        | 调用生产factory，不再写独立demo；真正MapCreate也接入资源释放                                         |
| Pointer/Wheel/focus/position/touch                                                                | D Runtime QA                                          | Desktop/CDP/Gallery与实际Mobile分层证明，不能用Figma静态QA替代                                       |
| Query-wide selection、atomic Choice、12colors、Vieworder、Audit/Recordprojection、AggregateSearch | C 跨层合同门槛                                        | 六Gate独立评审；当前UI部分可以做，不冒称新能力可用                                                   |
| Time/DateTime/12h、Table rollback、Avatar/Cascader/Conversion细粒度                               | E Future / Deferred                                   | 不阻断LaneA；另行领域/API/兼容授权后进入                                                             |
| 状态循环依赖/77类映射                                                                             | B 工程风险                                            | date-only不依赖DOM，date-picker不importRegistry/Controller；consumer依赖factory；不由Figma层级生成类 |

A设计足够明确不表示代码已完成。B是普通实现选择，不应逐项问用户。C只在相应未来能力启动前解决。D必须有测试证据；E不进入当前实现承诺。

## 2. 真正需要批准的事项

**本轮审计、正式规格与任务设计已授权；生产新切片通过首批明确handoff再执行。** Devin 获得明确切片授权后按正式指南执行。无需重新批准视觉或普通工程细节。

以下是未来合同的批准点，均不要求本轮重做已经选定的产品方向：

| 决策 ID    | 已确定方向                                                   | 仍需审查的合同 / 推荐                                                                                                                                                           | 何时阻断                                    |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| D-G1       | 12色视觉批准                                                 | reader兼容/未知色resave；inputenum/capability分阶段writer。推荐先保9色读写，新增3色等API rollout                                                                                | 启用新3色writer前                           |
| D-G2       | Existing与Draft原子create/select，不两HTTP降级               | 两种command精确body/outcome、Field+Recordrevision/lockorder、labelcanonical/权限、receipt/replay、queue格式迁移。推荐单事务+稳定body/id，Server先行                             | inline create与Draft intents持久化前        |
| D-G3       | server-owned Table View order，create/duplicate/restore tail | list一致snapshot、orderRevision/CAS、completepermutation、并发/lifecycle/default兼容。推荐独立Tableorder合同，禁止Plugin-local持久替代                                          | View拖拽持久化/tail新语义前                 |
| D-G4       | Header全query，binary/partial unchecked                      | membership/filter+searchfingerprint/count/token/TTL/exclusion/权限与scope失效。推荐Server scope；Sort/Display不改membership                                                     | Header全query选择可用前；不授权bulkmutation |
| D-G5       | Table-only统一Audit，当前Record投影无Actor、默认30d方向      | 全writer/eventpayload版本、event-time字段/option/presence、分页前投影、operation/change对应、applied/no-op与retention/capability。推荐先只读投影/安全availability，rollback独立 | W15-08B最终Ops投产前                        |
| D-G6       | Aggregate应与Record Filter+Search同范围                      | Server固定f398已批准/实现/部署；Plugin旧pin仍无Search，接入审查optional参数/capability、HTTP/InMemory/Controller/cache与旧Server安全不可用，独立于纯UI首批                         | 非空Search的query-wide数值汇总前            |
| D-Time     | Time视觉批准，领域未批准；12h保Future                        | 建议先Time-only分钟精度HH:mm/24hcanonical，12h只projection；这是候选。DateTime必须选择instant vswall-time，明确zone/DST/precision/跨日/nullable/Required/config/兼容            | Time/DateTime真实Field或持久化前            |
| D-Rollback | inclusive跨session整Table回到目标前、含资源inverse，30d方向  | writer覆盖/inverse/checkpoints/earliestRestorable/barriers、preview/headCAS/事务/权限/GC/unknown/replay。推荐独立Server阶段，不能以localUndo模拟                                | 正式恢复动作前                              |

G1/G6已按Server工作线授权审查并部署，固定合同/交付见API Boundary与唯一status；其Plugin接入仍未实施。G2–G5按独立精确合同推进，不能由产品方向或另一Gate交付推断Plugin能力已具备。是否进入P2.0批次在合同启动时确认；不用本轮改历史阶段定义。

## 3. 风险登记（当前与跨层分开）

| 风险                                    | 严重度 / 任务       | 证据及触发                                                   | 预防与验收                                                                                         | 回滚 / 状态                                            |
| --------------------------------------- | ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| R01 Date重复/旁路commit                 | 高 / 10–11          | renderer blur、Detail Date change、outside/Confirm同tick     | Date分支移除旁路；同步claim同promise；deferred race证明接受1次、选择0次                            | 回退窄consumer adapter，不改日期数据；待实施           |
| R02 原context晚响应投给新UI             | 高 / 02/08/09/10/11 | 异步值、history/recycle、Rename、dispose/context切换         | 捕获context+epoch；UI取消未发；已发归原operation；latepublish0次                                   | 按owner窄PR revert；待实施                             |
| R03 Draft internalfocus提前Create       | 高 / 11             | Grid整行focusout和Map真实Form生命周期                        | owned overlay归Draft；内部Tab不create；invalid outerCreate阻止且保raw；Map各出口dispose            | 恢复旧Dateadapter；无fakeID/提前写；待实施             |
| R04 hidden widths丢失/resize覆盖        | 高 / 04             | Display重建visiblewidth；validator拒hidden；全config替换     | active hiddenwidth保留；mergeownedintents against latest CAS；交错resize测试                       | 窄Display/validator revert；不重置View用户配置；待实施 |
| R05 Undo busy丢command/数量错           | 高 / 08A            | undo/redo先pop后busyguard；filteredmetadata与stack索引不一致 | guard先pop；稳定commandkey/原stack位置；并发/failedstep/deferred测试                               | 仅Undo逻辑可revert；不把localundo暴露为Table恢复       |
| R06 历史被当前schema/分页后过滤伪造     | 高 / G5/08B         | currentField lookup/Actor列；Recordcategory投影能力不足      | Server分页前投影+event-time快照；unknown facts诚实不可用；readcontext/singleflight/410             | 08A先交付；08B保持Gated                                |
| R07 Filter child不归owner/晚选择错rule  | 高 / 02             | ignored closehandle、positionalpath、parent outside误关      | stableidentity+caller epoch；ownedchild；debounce/dispose；Field/operator/reorder/query变化fixture | 修复局部query模块；无API改动                           |
| R08 Grid宽度literal/冻结Footer偏移      | 中高 / 05–06        | 56index多处literal；Footerrowheight/frozenoffset分离         | 单geometry model覆盖header/body/footer/canvas/range/fallback；实际scroll/hit/rail检查              | 小PR分区整合，保keyed/rAF，避免整Renderer重构          |
| R09 页面加载抹掉ready/旧cursorappend    | 中高 / 06           | continuation全局Loading，tail race                           | readyrows保持、incrementalstatus、singleflight/queryepoch、underfill/410/scrollanchor              | 当前loadNextPage可回退；不引入假9000rowspacer          |
| R10 AggregateSearch显示错误全query结果  | 高 / G6/05          | 当前AggregateRequest只有Filter                               | Search非空先truthfulunavailable；ServerSearch合同/缓存key/latequery后再启用                        | G6关闭capability；不可用loadedpage重算伪装             |
| R11 Atomic Choice两请求部分成功         | 高 / G2             | 当前Field与Record不同HTTP/lock路径                           | 单事务/revision/lockorder/稳定replay，Draftintents随Create；不fallback两请求                       | 未解锁保持现有ID选择；新command rollout可停writer      |
| R12 Query选择伪全Table                  | 高 / G4/05          | loaded set不知未加载membership                               | Serverqueryscope；partialunchecked；空disabled；Ctrl+A矩形独立                                     | 新scope入口关闭，不删除Current键盘能力                 |
| R13 Portal主题/a11y命中漂移             | 中 / 01–05/10       | bodyportal不继承loom-root，既有2pxCheck/20pxMore             | owner/themebridge局部；实算两theme、键盘/SRlabel/非重叠hit；不能从源码直接宣称颜色bug已观测        | scopedCSS/portalowner窄回滚；待browser/host验证        |
| R14 Field失败丢输入                     | 中高 / 01/07        | dialog提前close再await                                       | onepromise/busy；成功才close、失败draft/inlineerror；原owner returnfocus                           | 局部Form修复；待实施                                   |
| R15 clean-clone 合同遗漏或平行规范      | 高 / 00             | 文档提炼后未完成链接/完整覆盖与入口审查                      | DS/HIG/Grid/architecture 唯一来源，formal 执行入口不依赖本地材料；W15-00 审查                      | 文档已准备，待审查发布；窄 docs PR 可回滚              |
| R16 过度抽象或循环依赖                  | 中 / 07/10          | Registry预期seam被误当已有框架，77assets→77类                | 窄handle/日期pure模块/Date-localhelpers；保nativefactory；测试真实consumer                         | 保数据格式/API，代码窄回退；无需用户选类名             |
| R17 测试误连生产/共享DB                 | 极高 / futureServer | integration_test test DB DROP SCHEMA public CASCADE          | 仅隔离CI/可销毁专用DB，环境owner/权限明确；不默认Docker，不重置生产                                | 环境不具备即标未测，不执行；当前只读                   |
| R18 静态QA冒充runtime/设备通过          | 高 / 12             | Figma有界read、jsdom/gallery/TS各有证明边界                  | 每层记录真实结果；Desktop必须关键路径；实际Mobile unavailable标未验证；synthetic fixtures          | 不误标Done/发布；无测试结果编造                        |
| R19 并行修改巨型renderer/controller/CSS | 中高 / 所有         | 多产品共享核心文件                                           | 单集成owner，模块可并行核心集成串行；重基当前main，唯一statusclaim                                 | 逐窄PR回滚；不依赖跨session消息                        |
| R20 API pin静默升级/Queue身份变         | 高 / 所有/G2        | ServerHEAD比pin新，api:check写generated                      | Current LaneA pin/hash零变；未来API授权先Server，再明确固定SHA/codegen审查；重放仍原body/id        | 暂停意外API diff；不手改generated/换id重发             |
| R22 恢复能力覆盖/30d虚假保证            | 高 / F-Rollback     | readable日志不包含完整inverse，部分conversionDeferred        | 真实earliestRestorable/barriers/checkpoint/GC；rollbackpreview全部resources，atomic/headCAS        | Gate保持关闭；旧recordrestore继续现有合同              |

上述是未实施风险，不代表已在实际宿主重现每一失败。源码明确的旁路/validator/Undo顺序可定位；CSS/布局/输入设备必须运行验证。测试场景与具体模块见任务卡，风险状态由唯一trackedstatus在实施时更新。

## 4. 验证限制与关闭条件

- 当前文档整理未运行产品测试/build/codegen、Server 请求或实际宿主测试；首次代码切片记录真实基线，不能搬用历史通过数量。
- Figma 是静态批准基线。Pointer/Wheel、Focus、Popover 布局、资源释放和保存竞态需要 Gallery/Obsidian Runtime 验证。
- 没有真正移动设备验收时明确标未验证；Desktop 仿真不签 Mobile 通过。
- 六条 Server 合同目前仍是 Gate，真实 endpoint、兼容性、隔离事务测试和部署版本交付后才能关闭。
- 每个新 Session 读取实际 HEAD、工作树、CI 和固定 API；审查基线不保证远端 main 始终相同。

## 5. 推荐处理

先完成 W15-00 的文档审查/发布，然后按明确授权交付 Lane A 的纵向 UI 切片。Server Gate 按产品需要独立进行 API-first 评审与实施，Plugin 仅等待相应合同，不等待全部未来功能。当前没有必须重开 Figma 的设计阻断；类名、CSS 组织、局部 helper 和 listener 释放由开发者在既有合同内决定。

## 4. 当前 HEAD 独立确认的首批门槛

固定52b2c9dc0a126ab23217973161b5dd5440b02bc1的证据在 [ui-alignment](ui-alignment.md)，不把旧SHA结论直接沿用。仅记录工程门槛，实际处置状态仍在status。

| 风险 | 严重度 / 精确证据 | 最小处理与验收 |
|---|---|---|
| R23 完整Menu focus boundary遗漏 | P1：Grip trigger→真实Tab到Field时menu仍Open；document Arrow将外部焦点夺回item | 01/A：统一trigger+portal focus离开判定、Arrow owned guard；保pointertoggle/外点/动作/Esc与跨Pane |
| R24 Renderer换Map只null不dispose | P1：showMap/renderGrid源码出口；真实Map页面仍保旧Query capture pointerdown且732ms后PATCH旧Grid View | 01/A：capture后所有替换出口dispose；父UI资源清理先于Controller失效；Map/Grid/Pane测试覆盖晚于ViewWrite debounce的完整窗口；已确认late PATCH |
| R25 Filter dispose提交未发/queued | P1数据正确性：真实Renderer+Controller定向测试在controller dispose后updateView1；deferred finally在dispose后onApply第二次 | 01/A：显式close reason、纯dispose与generation/queue guard；有效normal-close串行flush仍保；in-flight身份不改，无新owner publish |
| R26 Palette keyboard type替换泄漏 | P1资源正确性：PaletteDOM已移除，pointer capture listener仍active，父Esc才释放 | 01/A：先dismiss子config再replace；row/config/选项/pending/parent/host出口幂等配对 |
| R27 基础视觉/Golden假完成 | P1：真实Primary白底，Toolbar30/r8，Grid56system、20More、40tail、15body；Gallery没有宿主CSS竞争 | 01/B→05/09/C：真实consumer与同源Showcase/Host量尺；三门独立，无截图/量值对应不签视觉通过 |

设计无需本轮重新裁决；字体家族/抗锯齿/native语义颜色允许适配，结构/控制密度不允许漂移。整页authority缺失先组合既有HIG/组件，仅真正冲突才提交具体证据询问，不用个人审美补设计。

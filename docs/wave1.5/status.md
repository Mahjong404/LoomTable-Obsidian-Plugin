# Wave 1.5 — 唯一实施状态

更新：2026-10-12。只记录实际实施、授权与交付引用；范围见README/implementation-plan，行为见UI/Architecture，任务合同见task-specifications。用户本轮调整为真实UI审计→精确规格→首批代表性页面，不直接继续W15-03。

## 批准与当前基线

| 对象 | 状态 | 生效范围 / 引用 |
|---|---|---|
| Wave 1 / Wave 1.5设计 | Approved / Frozen；Approved | 已批准视觉/布局/交互，Future/API门槛保留，不重开设计 |
| W15-00 正式文档基线 | Done | Plugin69e296cc6a02f74ca61a633c6168fb36b9b89398；Server5d430cd641e5a210eab3371c9864919837cd69a9已发布 |
| 当前Plugin代码 | main@52b2c9dc0a126ab23217973161b5dd5440b02bc1 | 本轮本地/远端核对一致，开始tracked tree干净；01/02已有实现和修复 |
| 本轮UI工程重校准 | 审计/规格获授权；未实施产品修复 | Figma live + isolated snapshot/Obsidian证据见ui-alignment，第一批A→B→C合同已补齐；正式规格按docs PR review交付 |
| Plugin API pin | 43da70e3c241380fff34d0deee8c1142ba39cb47 | 旧writer9色/Aggregate无Search，本轮保持source/generated零变化 |
| Server固定交付 | G1/G6已交付；其Plugin消费者未接入 | 详细contract/commit/capability验证来源如下表；其余Gate仍独立 |
| Time/DateTime、12h、整Table回滚 | Future / API-gated | Avatar/Profile/Cascader/细粒度转换审计Deferred |

审计bundle SHA-256 4f00ca03ecc5c117ea3cb5c9b064415c6a98100f63d73e90e7d89cfb32c93b89。Obsidian1.14.4、合成Vault/loopback内存API；本轮没有修改用户数据或产品源代码。旧336db8c/Server5f4827f是初始规划基线，新Session读取实际HEAD。

## 实施包

| Task | State | Owner / code baseline | Checks / Host QA与实际边界 | Next action |
|---|---|---|---|---|
| W15-00 | Done | Devin / 文档基线69e296c | 既有文档已发布；本轮仅在同一规范上补精确工程验收 | 不重复启动 |
| W15-01 Primitive消费者 | Review / Incomplete | 实现5e55e68 + remediation732e855；当前52b2c9d | Devin此前报告1048 tests/静态检查/build/隔离Host PASS；**不能据此认定六项及视觉全部完成**。本轮固定快照原有1048项全通过；format/typecheck/build通过、lint0error/718存量warnings、API生成SHA未变（分项CLI执行）。另3个现有菜单/Field/Filter文件72项通过，4个追加定向复现失败：完整Menu boundary、config Palette释放、dispose未发Filter写入、disposed queued apply。真实Grip Tab/Arrow、Palette键盘切type、Map旧Query listener及732ms后旧Grid PATCH复现；双Pane A菜单不被B render关闭且新B menu替换A、Reduce Motion0s通过。当前Primary/Toolbar量值偏差见矩阵 | 首批A正确性，再B视觉/同源Showcase；独立review与Host重验 |
| W15-02 Filter | Review / Visual not accepted | 实现bde37b9 + remediation27e00bd（集成01修复）；当前52b2c9d | 已有stable identity/generation/reorder修复及历史Host证据；本轮未重复完整原实现review。Filter32px controls/文字Remove等旧anatomy尚未对齐；owner销毁flush是共享新确认门槛，valid draft count待定向验证 | A共享正确性先修；Golden通过后02视觉续段，不重复计算已修02旧缺陷 |
| W15-03 Sort | Planned / Hold | — | 未实施批准的临时Add/Grip新版；当前旧UI不是01/02回归 | 首批代表性页面达标后启动 |
| W15-04 Display | Planned | — | 新positive visibility/More/density/hidden widths merge未验收 | 02视觉/03后；不阻断当前合法config的05几何子集 |
| W15-05 Grid | Planned | — | 真实system56/More20/tail40/body15/Footer gap8；standard rows36/Footer36已正确 | 首批C交付geometry/typed展示子集；完整04/G4/G6分别追踪 |
| W15-06 Continuous loading | Planned | — | 未运行本包验收 | Grid基线后 |
| W15-07 Choice / Field Type | Planned | — | 当前9色/native types保持；Tag视觉及完整Picker目标有差异 | C含9色Tag窄展示接缝；完整07、G1/G2独立 |
| W15-08A Activity / Undo安全 | Planned | — | 未运行本包验收 | 页面基础稳定后按共享owner推进 |
| W15-08B 最终操作入口 | Gated | — | G5完整投影/metadata/identity未交付 | 不做假feed |
| W15-09 View / Rename | Planned | — | 当前Tab30/r8/600；导航可用，完整Rename/生命周期未验收 | 首批C仅Tab/Context外观；其余与G3保持原范围 |
| W15-10 Date / Grid | Planned | — | 实际仍native date input；Calendar未实施，不报01回归 | 07窄handle/稳定Grid后 |
| W15-11 Date消费者 | Planned | — | Detail/Draft/Map基线入口可达；新Date消费者未实施 | 10后 |
| W15-12 集成验收 | Planned | — | 本轮局部CDP审计不等于全Wave Host QA Passed | 按包及Golden三门；保未验证设备/能力 |

仍为W15-00–12共13包，08A/B是分段，首批A/B/C不是新任务包/第二状态表。所有部分交付不得自动标父包Done；下一Devin交接范围只限任务卡首批，不自动派发所有W15。

## API / Future

| Gate | Contract approval | Server PR / fixed source / merge | Deployed capability /验证来源 | Plugin PR / pin | State / Next action |
|---|---|---|---|---|---|
| G1 12色writer | Approved，固定合同47fc985 | [PR10](https://github.com/Mahjong404/LoomTable-Server/pull/10)；47fc985bd9376dc761469b40fe40dcfd1ceb483e；merge173c2f031dd4acf0957a40afcb07e94125e8305f | Server tracked delivery：v0.3.0+47fc985→后续v0.4.0保choicePalette12，CI/公开Meta/恢复/回滚已验证；本Session未再次请求生产 | 未接入，仍43da70e | Deployed / Capability Verified（Server证据）；未Plugin Integration Ready，先pin/旧新writer/unknown reader，再消费者 |
| G6 Aggregate Search | Approved，固定合同f3980b1 | [PR11](https://github.com/Mahjong404/LoomTable-Server/pull/11)；f3980b1b4126cdfce026c0a94779c8c8261b3997；mergebf6237b7450af3ff3ca1ba9d0155c19096a352fb | [固定交付证据](https://github.com/Mahjong404/LoomTable-Server/blob/bb00e6ad3d100a6e5e0879d1e8c1fb25ab51bfec/docs/wave1.5/deliveries/g6-aggregate-search.md)：v0.4.0+f3980b1b4126、公开/内部Meta aggregateSearch、CI/隔离DB/恢复验证；本Session只核对tracked交付 | 未接入，仍43da70e | Deployed / Capability Verified（Server证据）；未来固定f398同步/生成/HTTP+InMemory+Controller+stale/capability，不在本轮启用 |
| G2 Atomic Choice | 精确合同未交付 | Server工作线后续 | 未验证 | 未接入 | 事务/双CAS/receipt/Queue正式交付前，不两请求伪原子 |
| G3 View order | 精确合同未交付 | Server工作线后续 | 未验证 | 未接入 | snapshot/orderRevision/CAS/tail独立交付 |
| G4 Query RowSelection | 精确合同未交付 | Server工作线后续 | 未验证 | 未接入 | 不伪loaded/all-query |
| G5 Audit / Record projection | 精确合同未交付 | Server工作线后续 | 未验证 | 未接入 | 08B保持Gated |
| F-Time / DateTime / 12h | 领域合同未完成 | — | 未验证 | — | Future，视觉批准不解锁字段 |
| F-Rollback | 技术合同未完成 | — | 未验证 | — | inverse/checkpoint/preview/headCAS另行合同 |

API Boundary引用实际Server固定合同与发布证据；原Server工作线已获G1–G6工程授权，不能再记成全未授权，但该授权不等同Plugin所有消费者已交付。G1/G6当前不是Server Pending，Plugin Integration仍Pending；一次pin含两Gate不自动完成两消费者。

## 验收与更新规则

功能、Figma视觉量尺、Obsidian Host分别签证据；测试总数只描述真实命令结果，不作产品完成证明。本轮真实触控/Mobile、200%缩放、完整Map marker/Record mutation及Server持久联调未验证；合成stub无上述证明力。历史忽略目录QA材料可选，不是任务必需输入。

每次接手记录实际owner/branch/base HEAD、授权子集、共享文件、PR/merge SHA、检查/exit/CI、Figma node+variant与host尺寸/主题/字体/操作状态及限制。发现已修路径复核，不沿用旧结论；视觉失败回原子段，不跳下个包。只从本表/正式规范/PR恢复，不依赖跨Session聊天。

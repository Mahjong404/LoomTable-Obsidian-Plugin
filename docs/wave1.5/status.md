# Wave 1.5 — 唯一实施状态

更新：2026-10-12。本表只记录实际实施、审批与交付引用；范围见 README，行为见 UI/Architecture，任务合同见 task-specifications。设计已批准，Lane A 实施进行中。

## 批准与当前基线

| 对象                              | 状态               | 生效范围 / 引用                                                                                                                                 |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave 1                            | Approved / Frozen  | 保留已交付基线                                                                                                                                  |
| Wave 1.5 设计                     | Approved           | 当前 authority 视觉、布局和交互；Future/API 门槛保留                                                                                            |
| 正式文档准备                      | Done               | 已审查并提交：Plugin `69e296cc6a02f74ca61a633c6168fb36b9b89398`、Server `5d430cd641e5a210eab3371c9864919837cd69a9`（本地 main，push/PR 未授权） |
| Lane A 实施授权                   | W15-01 已授权      | 用户 2026-10-12 输入授权 W15-00 文档基线与 W15-01 切片                                                                                          |
| G1–G6 合同 / Server 实施          | Gated              | 每条批准、Server commit、部署 capability 与 Plugin 接入分开记录                                                                                 |
| Time/DateTime、12h、整 Table 回滚 | Future / API-gated | 不进入当前生产任务                                                                                                                              |

审查基线：Plugin 336db8c47a5bf52a63eb1a4a127002c43872cf1e；Server 5f4827f6b7a7f189aac13e3bc3c0e92377a7873e；Plugin API pin 43da70e3c241380fff34d0deee8c1142ba39cb47。文档基线 commit：Plugin 69e296cc6a02f74ca61a633c6168fb36b9b89398、Server 5d430cd641e5a210eab3371c9864919837cd69a9。新 Session 必须读取实际 HEAD，不把这些值当永久最新。

## 实施包

| Task                         | State      | Owner / Branch | Dependencies               | PR / Merge HEAD                         | Checks / Host QA                                                                                                     | Next action                                  |
| ---------------------------- | ---------- | -------------- | -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| W15-00 文档基线              | Done       | Devin / main   | 当前文档审查               | Plugin 69e296c / Server 5d430cd（本地） | 271 相对链接/锚点零缺失；13 包×18 字段、39+R40、77 资产、6 Gate 一致；prettier/git-diff --check 通过；产品测试未运行 | push/merge 待用户授权                        |
| W15-01 Primitive 消费者      | Done       | Devin / main   | 00（69e296c）与切片授权    | Plugin 5e55e68（已推送 origin/main 388490b） | 1011 vitest 全绿；tsc/eslint(0 err)/prettier/git-diff --check 通过；api:generate 零 diff；esbuild production 成功；Obsidian 宿主/CDP 未验证（9223 无调试实例，宿主验收阻塞） | 宿主 QA 待调试环境                          |
| W15-02 Filter                | Done       | Devin / main   | 01                         | Plugin 待提交                            | 1029 vitest 全绿（+18 新测试）；tsc 0 错；eslint 0 error；prettier/diff --check 通过；api:generate 零 diff；esbuild production 成功；Obsidian 宿主/CDP 未验证 | 宿主 QA 待调试环境；W15-03 待授权            |
| W15-03 Sort                  | Planned    | —              | 01                         | —                                       | 未运行 / 未验证                                                                                                      | transient Add/whole entry move               |
| W15-04 Display               | Planned    | —              | 01                         | —                                       | 未运行 / 未验证                                                                                                      | latest-base width/freeze intent              |
| W15-05 Grid                  | Planned    | —              | 01、04                     | —                                       | 未运行 / 未验证                                                                                                      | 几何/validation 可交付；G4/G6 另记录         |
| W15-06 Continuous loading    | Planned    | —              | 05                         | —                                       | 未运行 / 未验证                                                                                                      | ready retained rows/epoch/underfill          |
| W15-07 Choice / Field Type   | Planned    | —              | 01、05                     | —                                       | 未运行 / 未验证                                                                                                      | 现有 ID/9 色先做；G1/G2 保持门槛             |
| W15-08A Activity / Undo 安全 | Planned    | —              | 01、05                     | —                                       | 未运行 / 未验证                                                                                                      | 现有读竞态、stack、Deleted restore           |
| W15-08B 最终操作入口         | Gated      | —              | 08A、G5                    | —                                       | 未运行 / 未验证                                                                                                      | 等待真实 Record projection/metadata/identity |
| W15-09 View / Rename         | Planned    | —              | 01                         | —                                       | 未运行 / 未验证                                                                                                      | 当前导航/命名；order 等 G3                   |
| W15-10 Date / Grid           | Planned    | —              | 01、05、07 handle          | —                                       | 未运行 / 未验证                                                                                                      | pure Gregorian + single commit owner         |
| W15-11 Date 消费者           | Planned    | —              | 10                         | —                                       | 未运行 / 未验证                                                                                                      | Detail/Create Draft/Map 生命周期             |
| W15-12 集成验收              | Planned    | —              | 当前授权 Lane A 的所有切片 | —                                       | 未运行 / 未验证                                                                                                      | 分层 QA；未解锁能力不得标完成                |

W15-08A/B 是一个任务包的两个交付阶段；本批仍为 W15-00–12 共 13 包。W15-05/07/09 的当前子集完成不表示相关 API Gate 交付。

## API / Future

| Gate                                   | Contract approval | Server PR / 40 位 commit | Deployed capability / compatibility | Plugin PR / pin | State / Next action                           |
| -------------------------------------- | ----------------- | ------------------------ | ----------------------------------- | --------------- | --------------------------------------------- |
| G1 12 色 writer                        | 未完成            | —                        | 未验证                              | —               | Gated；reader-first/enum/rollout              |
| G2 Atomic Choice                       | 未完成            | —                        | 未验证                              | —               | Gated；双 revision、事务、receipt、Queue 兼容 |
| G3 View order                          | 未完成            | —                        | 未验证                              | —               | Gated；一致 snapshot/CAS/tail                 |
| G4 Query RowSelection                  | 未完成            | —                        | 未验证                              | —               | Gated；membership/snapshot/TTL/exclusion      |
| G5 Audit / Record projection           | 未完成            | —                        | 未验证                              | —               | Gated；分页前投影、event-time、identity       |
| G6 Aggregate Search                    | 未完成            | —                        | 未验证                              | —               | Gated；独立正确性补齐，例外需批准             |
| F-Time / DateTime / 12h                | 领域合同未完成    | —                        | 未验证                              | —               | Future；UI 视觉批准不解锁字段                 |
| F-Rollback                             | 技术合同未完成    | —                        | 未验证                              | —               | Future；inverse/checkpoint/preview/headCAS    |
| Avatar/Profile/Cascader/细粒度转换审计 | 无当前实施授权    | —                        | —                                   | —               | Deferred                                      |

Server 自身 PR/合同文件记录其代码、审查和测试证据；本表是整个批次唯一进度汇总。Server handoff 交付 PR/commit/能力说明后，由 Plugin 集成切片同步本表，不要求 Server Session 持有 Plugin 工作树。不得各新建一个相互矛盾的全批进度清单。

## 更新规则

Planned：范围已列出但启动条件未完成。Ready：具体执行获授权、前置交付且文件所有权清楚。InProgress：一个 owner claim。Review：可审查 diff 与验证结果。Done：DoD、约定审查/合并及实际证据齐全。Gated/Future/Deferred 保留具体原因。

每次接手记录 owner/branch、真实 base HEAD、授权范围、共享文件、PR/merge HEAD、实际命令/exit 或 CI、宿主设备/主题/pane/限制及下一步。宿主未测就写未验证，不沿用历史测试数量；失败回原切片修复。新 Session 直接读本表、相关 PR 和真实源码，不依赖上一 Session 消息。

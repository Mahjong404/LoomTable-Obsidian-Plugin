# Git 治理审计：2026-10-16

本页记录本次只读核查和实施边界，不替代产品状态表。审计 main：`99aae27b7ee0834316ec53c70a704a85f087e3f0`。数据来自 GitHub connector 的 branches、全部分页 PR、commits、Git refs/tags、releases、rulesets 与 repository metadata，以及本机只读 Git/Worktree 检查。两个仓库当前均无独立 Issue；Plugin 仅 #116 开放，Server 无开放 PR（治理 PR 创建前）。

## 分支台账

A：已完成、成果保全、当前未发现有效依赖；B：等待开放 PR；C：先保全/裁决；D：活跃或 main。所有建议删除在实际执行前必须重查远端 HEAD 和本机依赖。下方保留删除前的分类与映射；实施结果见执行记录。

| 分支                            | HEAD SHA                                   | 最后提交 UTC         | HEAD 在 main | PR 状态                                                                         | 合入方式证据                            | 未合并独有修改                 | Tag/Release 保全 | 本机 Worktree                        | 类别 |
| ------------------------------- | ------------------------------------------ | -------------------- | ------------ | ------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------ | ---------------- | ------------------------------------ | ---- |
| codex/w15-loom-controls         | `e3c9f67bd7b19b215ff3486d4c35c8b9cc7038b6` | 2026-10-13T18:50:28Z | 是           | [#115](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/115) Merged | Merge Commit                            | 无                             | 无 HEAD 引用     | w15-ui-foundation（clean）           | D    |
| codex/w15-shared-lifecycle      | `156bd7a57591a21053505f749c3ec67c16b98ed0` | 2026-10-12T19:01:53Z | 是           | [#114](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/114) Merged | Merge Commit                            | 无                             | 无 HEAD 引用     | 无同名 Worktree                      | A    |
| devin/w15-c-grid                | `b76b4bf574d967d610e131c7f1e8884f6237f48e` | 2026-10-15T15:41:23Z | 否           | [#116](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/116) open   | —                                       | 有，开放 PR 中                 | 无 HEAD 引用     | 主 checkout（clean，本地落后远端 6） | B    |
| docs/agent-ops-sop              | `dab40d00d668834c597da86c98f2be933f80734b` | 2026-10-15T09:48:10Z | 否           | [#117](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/117) Merged | Squash 相符：1 父，tree 与 PR HEAD 相同 | PR 全部内容已合入；无后续 HEAD | 无 HEAD 引用     | 无同名 Worktree                      | A    |
| docs/release-v0.1.1-main-sha    | `964e38281e29b8c37650cb4739ea9f58e34ec965` | 2026-08-17T22:31:59Z | 无共同祖先   | [#19](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/19) Merged   | Merge Commit                            | PR 全部内容已合入；无后续 HEAD | v0.1.1 可达      | 无同名 Worktree                      | A    |
| docs/release-v0.1.1-package-sha | `0c8ca3dca3856ba28edc93382c466682b3d4e19f` | 2026-08-17T22:05:10Z | 无共同祖先   | [#17](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/17) Merged   | Merge Commit                            | PR 全部内容已合入；无后续 HEAD | v0.1.1 可达      | 无同名 Worktree                      | A    |
| docs/release-v0.1.1             | `d5d9c20ff59a459a871f098d11facd87b1f5dc42` | 2026-08-17T21:59:47Z | 无共同祖先   | [#16](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/16) Merged   | Merge Commit                            | PR 全部内容已合入；无后续 HEAD | v0.1.1 可达      | 无同名 Worktree                      | A    |
| docs/ui-engineering-rebaseline  | `96f7f7442b8937eeed3158bed9b9a70c0b9a9d19` | 2026-10-12T17:20:08Z | 是           | [#113](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/113) Merged | Merge Commit                            | 无                             | 无 HEAD 引用     | 无同名 Worktree                      | A    |
| main                            | `99aae27b7ee0834316ec53c70a704a85f087e3f0` | 2026-10-15T14:53:21Z | 自身         | 无                                                                              | —                                       | —                              | 无 HEAD 引用     | 无同名 Worktree                      | D    |

“Squash 相符”根据 PR 已 Merged、合入 commit 为单父、合入 tree 与最终 HEAD tree 完全相等、HEAD 后无新增提交得出；REST PR 不单独返回 merge_method。未把 Squash 的独有提交 SHA 误判为未合入代码。一般 Merge Commit 通过双父且包含 PR HEAD 核实。

| 分支                            | 删除前 HEAD                                | PR   | 合入 SHA                                   |
| ------------------------------- | ------------------------------------------ | ---- | ------------------------------------------ |
| codex/w15-loom-controls         | `e3c9f67bd7b19b215ff3486d4c35c8b9cc7038b6` | #115 | `fe9f24a87dea2226233d462b0300d60e8bf34be9` |
| codex/w15-shared-lifecycle      | `156bd7a57591a21053505f749c3ec67c16b98ed0` | #114 | `58175c1f5a5388c0386e64437f08ae3ba36a7ac2` |
| docs/agent-ops-sop              | `dab40d00d668834c597da86c98f2be933f80734b` | #117 | `99aae27b7ee0834316ec53c70a704a85f087e3f0` |
| docs/release-v0.1.1-main-sha    | `964e38281e29b8c37650cb4739ea9f58e34ec965` | #19  | `c5ebe89bf4a99485e70520d30cb073983558f2a1` |
| docs/release-v0.1.1-package-sha | `0c8ca3dca3856ba28edc93382c466682b3d4e19f` | #17  | `bae3ab89c787759cf51dce64f3e17725e86386e2` |
| docs/release-v0.1.1             | `d5d9c20ff59a459a871f098d11facd87b1f5dc42` | #16  | `5585dddc93553d012d1d1c123aeec4d2b77e02d0` |
| docs/ui-engineering-rebaseline  | `96f7f7442b8937eeed3158bed9b9a70c0b9a9d19` | #113 | `23681e6eeb7c92bfdcc83d8241f50e3a2a385abc` |

3 条旧 release 文档分支相对当前 main 的 compare 返回 404 No common ancestor；不能称其已成为当前 main 的祖先。逐一对已发布 v0.1.1 (`c5ebe89bf4a99485e70520d30cb073983558f2a1`) 比较，HEAD ahead=0，分别 behind=1/7/9，PR #19/#17/#16 的双父合入记录也保留在此 Tag 中。成果由正式发布历史保全，退役分支不改动 Tag/Release。此不连通结构是审计前已有事实，本次不推断成因、不修改历史。

## 本机保全与未推送内容

本机初始 5 个 Worktree 全部保留。w15-ui-foundation 引用 codex/w15-loom-controls，虽 #115 已合并仍归 D；#116 主 checkout 的本地 HEAD `4b25316912fe4444b7610f96cb3af362ffc754b0`，相对远端落后 6，不做切换或改名。

另有仅本地 dsh/ui-028 (`22695b465ec9042ee993dcf71076108d22c26301`，相对 main 独有 8 commits)、dsh/ui-031 (`e2d1719b4343581667568699404ed0e0b091227d`，独有 7) 与 fix/w15-c-remediation (`70e208fef6e3146ea69f6637c9b4a0a3c896e22f`，独有 6)，均无 upstream，不能声称已推送。补救 Worktree 存在 4 个 tracked 修改和 1 个 untracked 测试文件，属于当前产品工作，全部保留。独有数量是相对 main 的 ancestry，不代表未在其他产品任务中交付。

本地 codex/w15-shared-lifecycle 比同名远端多 1 个 merge commit `58175c1f5a5388c0386e64437f08ae3ba36a7ac2`；该 commit 已在 main，无未保全独有代码。其余 A 类远端分支没有同名本机 Worktree/未提交内容。本地 main 落后远端，不拿本地 branch list 当远端现状。

上述检查只覆盖当前主机；其他设备、远程实现者的未推送内容无法从 GitHub 读取。删除候选若有新 Owner/依赖出现，降为 D/C 后重审。未清理任何未确认 ignored 快照。

## Tag、Release 与身份

- v0.1.0 → `5f5db46f37efb0f146cf53d7e8f6e3d36db179fb` (commit)
- v0.1.1 → `c5ebe89bf4a99485e70520d30cb073983558f2a1` (commit)
- [v0.1.1 Release](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/releases/tag/v0.1.1)，target `c5ebe89bf4a99485e70520d30cb073983558f2a1`，发布于 2026-08-17T22:39:41Z。
- [v0.1.0 Release](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/releases/tag/v0.1.0)，target `5f5db46f37efb0f146cf53d7e8f6e3d36db179fb`，发布于 2026-08-17T17:49:27Z。

本地两仓有效 user.name/user.email 均继承用户全局合法身份；connector 当前账户为 Mahjong404，profile 邮箱与有效本地邮箱一致。历史 main 还存在另一个关联同一 Mahjong404 的个人邮箱，不需要因此统一改写。PR Author 与 Commit Author 分别查询，当前相关 PR 的 author.login 均为 Mahjong404。个人 Emails 设置是否 verified 未通过受限 connector 核实；API 账户映射已核对。

当前 main 的完整 118 个可达提交中，11 个提交包含工具共同作者尾注。它们的 Author/Committer 都是用户本人，API 的 author.login 为 Mahjong404；不是 PR 作者变成工具账户。尾注为 `Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`。这足以解释共同作者归属来源；connector 不允许 contributors/stats API（400 URL not allowed）；获准网页访问后，主页实测 Contributors=2，列出 Mahjong404 与 devin-ai-integration[bot]。图表详情读取超时，未核实每人的实时计数，不把 main 中 11 条尾注直接称作图表计数。

| [`f8c8ba2a5ab8d4bf425b63f186ed136a97c90a3d`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/f8c8ba2a5ab8d4bf425b63f186ed136a97c90a3d) | Wave 1.5 status: record G1/G6 bridge delivery and PR113 merge |
| [`eed381bcacba2d4d9650efe20dd84f5f515629e2`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/eed381bcacba2d4d9650efe20dd84f5f515629e2) | API bridge: pin Server f3980b1, wire G6 aggregate search, sync G1 palette types |
| [`27e00bdecb0c91d5e1258c25cb16cb77aa7db3af`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/27e00bdecb0c91d5e1258c25cb16cb77aa7db3af) | W15-02 review remediation: owned menu boundary, request generations, stable ids |
| [`90d93851b30200437949466ce186d075ee2a3938`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/90d93851b30200437949466ce186d075ee2a3938) | Wave 1.5 status + AGENTS: record review remediation, portable host QA |
| [`732e855e7e770f1c35a6fc97362e0257e7629dd3`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/732e855e7e770f1c35a6fc97362e0257e7629dd3) | W15-01 review remediation: owned menu boundary, draft lock, unload cleanup |
| [`bde37b9291aa21e179524a492364b1368f978b9b`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/bde37b9291aa21e179524a492364b1368f978b9b) | W15-02: Filter stable rule identity, sibling reorder, and owned distinct-value lifecycle |
| [`5e55e6846a37c57ce5fdb247d0bb01e5c441ee80`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/5e55e6846a37c57ce5fdb247d0bb01e5c441ee80) | W15-01: align primitive consumers, menu/toolbar semantics, and overlay failure lifecycle |
| [`336db8c47a5bf52a63eb1a4a127002c43872cf1e`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/336db8c47a5bf52a63eb1a4a127002c43872cf1e) | docs(ui): sync P1.6 Slice C–E contracts into formal specs |
| [`92dcb8e0bacd9fa84dc2fc6b0e1d01b5a59f7060`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/92dcb8e0bacd9fa84dc2fc6b0e1d01b5a59f7060) | feat(grid): P1.6 Slice E — status tab keyboard contract + footer dedup + F-5 diagnostics |
| [`73a8485c15059c8ee9e62760eb1efc92db4fe075`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/73a8485c15059c8ee9e62760eb1efc92db4fe075) | feat(grid): P1.6 Slice D — anchored view popover + type picker + overlay context menus |
| [`0f4d3a2d5150f3aa845a189bb426997f2983d463`](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/commit/0f4d3a2d5150f3aa845a189bb426997f2983d463) | Fix OpenAPI snapshot trailing newline drift. |

这些非人工共同作者尾注与本次确立的“工具不形成独立贡献身份”规则不一致；不能仅凭提交元数据判断当时是否曾被授权自动署名。未来在提交和 Squash 最终 message 中停止自动添加工具尾注，保留真实外部人的合法贡献。

历史处理首选保留现状。删除远端分支、改 PR 作者显示或新增 `.mailmap` 不会从既有 message 中移除这些尾注，也不保证改变 GitHub Contributors。若坚持移除历史工具共同作者，需要另行批准对相关历史 commit message 的重写（不是伪造 Author），受影响提交及所有后继 SHA 都会改变，需要协调所有克隆、开放 PR、Worktree、固定 pin、签名和 CI/审阅引用。受影响历史若被 Tag/Release 保留，要决定保留旧历史还是重新发布新版本；移动已发布 Tag 会破坏追溯，本 Session 不执行。旧 SHA 链接及审查/CI 证明不能视为新 SHA 的证明；改写后显示缓存仍可能延迟，必要时联系 GitHub Support。见 [共同作者机制](https://docs.github.com/en/pull-requests/how-tos/commit-changes/creating-a-commit-with-multiple-authors) 与 [Contributors](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors)。

## Settings 与执行限制

两仓默认分支 main；allow_squash_merge、allow_merge_commit、allow_rebase_merge 均 true；delete_branch_on_merge 均 false；rulesets 返回空，branch list 的 protected=false。读取 main/protection 返回 **403 Resource not accessible by integration**；用户 metadata 显示 admin=true 不等于 GitHub App 有 Administration 权限。用户明确授权改用已登录 GitHub 网页后，两仓 Settings → Branches 均显示 Classic branch protections have not been configured；rulesets 为空，当前没有 Required Checks 保护配置。本次未新增保护规则，以免改变在途产品 PR 的合并约束；建议治理 PR 检查通过后再按 SOP 配置 main 防强推/删除及适用检查。

当前 connector 没有删除 ref 或修改 repository Settings 的写入接口；tags/contributors 直接列表 URL 不在 fetch 白名单（400），Tag 已通过允许的 git/refs/tags 核实。用户在本 Session 明确批准改用网页执行安全清理和设置；未使用 git/gh 远端写入。

已执行：网页启用 Automatically delete head branches；Squash 默认消息改为 PR title + description。随后通过 connector 重新读取，确认 delete_branch_on_merge=true、squash_merge_commit_title=PR_TITLE、squash_merge_commit_message=PR_BODY。Merge/Rebase 保留供已说明的例外，未改变当前 PR 状态。如需复核，打开 General → Pull Requests；分支保护入口为 Settings → Branches / Rulessets。

必需检查保持现有名称：check。先让本治理 PR 的检查实际出现并通过，再在 UI 核对 Required Checks；不以新 job 名代替原门禁、不关闭全部 CI。

## CI 差异与第三阶段

原工作流所有 PR/main 只跑 pnpm check。提案保留 check 名称，新增 PR 专属并发取消、明确正文白名单和范围回归；纯正文检查空白/修改 Markdown 格式；未知、源码、CSS、依赖、合同、Gallery/VitePress 或 CI 改动运行完整 check 和 Gallery/VitePress。main 始终全量，不设 workflow paths filter。

原来没有非 main push 触发，不新增它；PR 验证拟合入内容，main 验证实际合入内容，各有目的。新提交仅取消同 PR 旧运行；main 使用 run_id，避免 pending main 被取消。不新增 Matrix。

治理前远端 **9** 条；安全清理后 **3** 条。已逐条删除 A 类 **6** 条，删除前 HEAD 与审计一致，网页每行显示 Deleted / Restore；随后 connector 重新列举确认删除结果。Tag/Release 与 main SHA 均未改动。B：devin/w15-c-grid（#116 等用户视觉验收）；D：codex/w15-loom-controls（仍有 Worktree）及 main。治理 PR 会新增一个短期 chore/git-governance 分支，合并后按同一流程退役。

第三阶段：待产品 PR/活跃 Worktree 的 Owner 确认交付后，重查 HEAD、批准、独有提交、dirty/untracked/ignored 与下游 PR，再退役剩余历史名称。无需追求分支数量恒为 1。治理 PR 自身合并后同样退役。

## 简明交接

从最新 main 开始；任务语义短分支；使用用户合法身份、不加工具共同作者；一个目标一个主要 PR，CI/行为/Schema 必须 PR；普通小任务不强制公开 Issue；默认 Squash，重要历史例外需说明；Tag/Release 独立版本；保留其他 Owner 文件与 Worktree；失败用 Revert PR；清理先核实并记录 SHA。完整规则见 [Git 工作流](git-workflow.md)。本 Session 使用 0 个 Subagent。

## 本次验证

本地以最新远端 main 的只读源码快照验证，现有 checkout/Worktree 不被切换；使用现有依赖直接入口。本机 pnpm 11.25.0 拒绝链接依赖目录，故不声称执行了固定 pnpm 11.16.0 的整条命令；固定版本 pnpm check 与 Ubuntu 集成由治理 PR Actions 验证。

- 两仓各 22 个范围场景通过；YAML 解析、保守未知路径、删除/重命名边界与 main 全量策略通过。
- Plugin：70 个 Vitest 文件、1090 项测试通过（2 workers）；TypeScript 通过；ESLint 0 errors、743 条未修改源码的存量 warnings；Prettier 通过。
- API generated transport SHA256 前后相同；Production/Gallery/VitePress 构建通过，固定 OpenAPI/source 不变。

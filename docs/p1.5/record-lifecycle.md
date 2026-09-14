# P1.5：Record 生命周期

本文件覆盖 R1–R3，确定单条新增、删除、恢复和撤销删除的实现。已有 UpdateRecord/附件上传/冲突恢复继续复用。所有操作消费固定 OpenAPI，不新增 Server 路由。

## 命令与最低范围

通过 `mutate(tableId, { clientMutationId, commands: [command] })`，每次仅一条命令：

| 意图 | command | 结果 |
| --- | --- | --- |
| 新增 | `{ kind: 'createRecord', values }` | Server 生成 Record ID，返回完整 Record |
| 更新（已有） | `{ kind: 'updateRecord', recordId, expectedRevision, set?, unsetFieldIds? }` | 返回完整 Record，包括 unchanged |
| 软删除 | `{ kind: 'deleteRecord', recordId, expectedRevision }` | 返回带 deletedAt 的完整 Record |
| 恢复 | `{ kind: 'restoreRecord', recordId, expectedRevision }` | 返回恢复的完整 Record |

Create 不携带 recordId/expectedRevision；values 允许 `{}`，Primary Field 不必填。删除/恢复必须携带最新的权威 revision；禁止从时间戳或当前行索引推算。对已删除 Record 再 Delete、active Record 再 Restore 均可能返回 422 INVALID_STATE_TRANSITION；网络幂等重试依赖同一 clientMutationId，不能靠重复操作碰巧无害。

## R1：新增

1. Grid/Map 工具栏提供“新增记录”，打开同一字段表单，按 active Field 顺序排列。初始字段全部 Unset，不擅自写 false/0/空数组/“无标题”或根据 Filter 推导默认值。
2. 复用已有字段校验和编辑控件。空表单可创建；表单需要区分从未设置、明确清空、自然空值。取消/关闭经 dirty guard，没有请求、没有占位记录。
3. 本期新建表单支持已有标量/Select/MultiSelect/Location；Attachment 提示“创建后添加”，成功后进入 Detail 使用现有上传路径，不在尚无 Record ID 时启动上传事务。
4. 点击创建后对表单快照做一次规范化，生成一个稳定 `mut_...` clientMutationId，持久化待发送意图后才发送。重复点击/Enter 不产生新 key 或第二个请求。
5. pending 期间可切换 View，但创建 operation 由 profile runtime 持有。若关闭表单，状态仍可在保存/待处理入口找到；成功只更新所属 Table/连接，不把迟到创建结果打开到另一个当前 Table。
6. 成功采用 `results[0].record` 的真实 ID/revision/values，打开完整 Detail 或提供“打开新记录”。使相关 Query/Map Summary/viewport 失效，由 Server 重新排序筛选。新 Record 不符合当前 Filter 时也可以通过创建结果进入 Detail，不强行插入 Query 页面或伪增 totalCount。
7. 422 等确定失败保留草稿和字段错误；修正后属于新意图，生成新 key。超时、网络断开或无效成功响应属于结果未知，冻结原 request/key，显式重试原请求；未知期间不能修改 body 然后复用 key，也不能重置后创建副本。

## R2：删除、回收站与恢复

### 删除

- Grid 行菜单和共享 Detail 操作区提供单条软删除；Map 使用同一 Detail 入口。显示记录标题与作用范围，明确记录可恢复、附件原文件不删除，确认后才开始。
- 有未提交草稿先选择保留编辑或明确放弃；有已提交更新/上传关联/Conflict/未知结果时禁用删除并指向保存状态。这里采用“先处理现有写入再删除”，不把 Delete 越过队列中的 Update。
- 同一 Record 设置 lifecycle pending 闸门，其他 Leaf/Detail/附件 callback 也必须遵守；删除发出后禁止后续 Update 排入该 Record，避免删除后编辑。
- 等 Server 成功再将 Record 从 active 展示移除；pending 时显示处理中。失败保留原记录和焦点；未知时显示待确认，不能报告已删除。
- 成功后关闭或切换被删记录 Detail，焦点回邻近行/Marker/列表/空态入口；刷新关联 Query/Map，销毁该记录预览并使 Cluster token 失效。缓存中仍可存在回收态完整 Record，但不作为 active 命中。

### 回收站

- Table Shell 的 Record 管理入口打开当前 Table 回收列表，与“View 回收列表”分别标注。
- 调用 `query({ tableId, lifecycle: 'deleted', limit, cursor? })`，不带 active View 的 viewId/filter/search/projection，防止旧 View 筛选隐藏可恢复记录。回收列表采用 Server 默认排序和分页，只有已删除对象，没有本地软删除副本。
- 显示 Primary Field 标题、删除时间、只读 Detail、恢复动作；正常编辑/附件修改/再次删除禁用。允许没有 active View 时进入；祖先不可访问的 404 显示无法访问，不能当作空回收站。
- 重开或刷新能发现此前其他客户端删除的 Record。恢复前 getRecord 获取当前完整 Record，确认 deletedAt 和 revision，随后使用独立的新 clientMutationId 提交 Restore。
- 成功后移出回收列表并刷新 active Query/Map；恢复对象不符合原 Filter 或没有坐标时说明恢复成功但不在当前结果，不擅自修改数据或 Filter。

### 撤销删除

删除确认成功后提供“撤销删除”动作，指向同一 Record 的 Restore；不是把内存备份重新 create。操作保留在当前 session 的结果区直到用户关闭或切换 Table；无需倒计时或承诺资源保留时长。关闭后仍可通过回收站恢复。

撤销前重新读取 Record。如果已经 active，采用当前事实并提示已恢复，不再发 Restore；如果仍 deleted，使用当前 revision 发 Restore；404/权限/冲突显示明确状态。新 Restore 意图使用新 key，未知 Restore 的重试仍用原 key/body。

## R3：与队列、持久化和冲突整合

### 为什么必须改队列链路

当前 `PersistedMutationRequest.commands`、normalizer、legacy queue 和 scheduler 以 UpdateRecord 为中心。只修改 `MutationCommand` 联合或在按钮内直接 client.mutate，会绕过 FIFO、保存状态、重试、profile 隔离与未知结果恢复。

沿现有 runtime/store 扩展单命令操作模型，不建立第二套独立重试系统。生产 `LoomTableView` 注入的 durable port 和测试/legacy 路径都要兼容，或通过已验证的统一接口明确收敛；不得把真实路径留在 update-only。

### 操作身份与调度

- 已存在 Record 的串行 lane 使用 profile/Server/认证上下文 + tableId + recordId；同 Record 的所有写操作共享锁与状态。不同 Record 可沿用现有并发上限。
- Create 没有 recordId，使用本地 operation key（可直接使用 clientMutationId）追踪，不能伪造 `rec_...` 发给 Server。响应成功后关联真实 ID，后续编辑才进入该 Record lane。
- operation 保存 kind、tableId、关联 recordId（Create 可无）、原始 request/key、attempt、状态与时间；不可变 request 和用户可编辑草稿分开。
- 状态至少能区分 queued/sending/applied/error/conflict/auth-paused/terminal 及结果未知。可以复用现有枚举加独立 result-uncertain 标志，不要求为文档命名重构所有状态。
- 保存持久化失败时不发新请求；响应成功但本地落盘失败时保留原 key 和待确认状态，下次以原请求恢复。收到重复 applied 事件时按 operation ID 去重，不能重复刷新计数或打开两个 Detail。
- 断网时不接受新 Mutation；线上已接收的 pending/unknown 操作保留原请求，恢复在线后的既有恢复流程不得改 key/body 或绕过认证与保留期检查。

### 持久化兼容

扩展会改变已存 entry 结构，因此采用明确 v2 schema，提供 v1→v2 的确定性迁移：v1 UpdateRecord 保持原 ID、body、expectedRevision、重试/Conflict 状态，仅补内部操作身份；迁移必须先成功保存再调度。旧 sending 只表示结果可能未知，不等于未发送。

沿用既有条目数/字节上限和 profile 隔离，不把 Record 页或附件 bytes 塞进队列；业务 request 仅进入现有受控队列存储，不能打印或复制到日志/fixture。遇到未知高版本/损坏条目时保留原始存储，暂停并说明恢复失败；不得正常化成空队列后覆盖原内容。容量满拒绝新意图，不驱逐 pending 项。

### 重试与 Conflict

| 结果 | 必须行为 |
| --- | --- |
| applied/unchanged | 使用返回完整 Record 和 changeCursor；自身操作完成后再解除对应写闸门 |
| 400/422 | 保留错误和可修正草稿；终止原尝试，修正后为新意图 |
| 401/403 | 保留 pending 请求，暂停，待同一身份恢复；不得把它发送到其他 profile |
| 409 CONFLICT | 暂停该 Record；保留 expected/current revision、当前值与原 command kind；展示采用最新/重新审阅 |
| 409 IDEMPOTENCY_KEY_REUSED | terminal 实现错误；不伪装普通版本冲突，不自动生成新 key 掩盖问题 |
| 网络/超时/无效成功响应 | 结果未知；保留完全相同 request/key，由既有有界策略重试或用户显式重试 |
| 404 | 重新读取所属对象/祖先，提示不可访问，不作成功结论 |
| 422 INVALID_STATE_TRANSITION | 读回当前生命周期；说明已变化，停止旧动作，不循环执行 |

Record Conflict 与 V2 元数据 Conflict 的响应形状不同，client 解码不能混用。Delete/Restore Conflict 没有 submittedSet 时不得构造“空字段覆盖”UpdateRecord。用户采用 Server 意味放弃原生命周期意图并显示最新对象；要再次删除/恢复，先读回完整 Record 并重新确认，使用新 revision 和新 key。现有 UpdateRecord overwrite 行为保持。

Create 的未知结果不能通过搜索相同名称/值来判定成功；只能重放同一 key 获取历史结果。Meta 提供 idempotencyRetention；超过最短安全保留窗口或无法确认记录时间时暂停自动重放并提示用户核对，不能换 key 自动再创建。Delete/Restore 的读回可以确认“当前已删除/已恢复”，但不能据此伪造本次 MutationResult/changeCursor；需要刷新变化水位。

### 跨界面与 Change

- runtime 的 applied 事件通过现有 mutation-invalidation 通知同 Table 的 Grid/Map/Detail；旧 View 读取 generation 失效，旧 selected-record/Cluster 响应不得复活被删除记录。
- 只把 Server 返回 Record 当权威，不自行 revision+1。全局计数、分页成员、Map 聚类均重查，不本地推算。
- View 级保存状态聚合 Create/Update/Delete/Restore 和 View 配置保存；Error/Conflict/未知结果不能被其他成功操作显示为“全部已保存”。
- 从一个 Leaf 导航离开不丢 operation；卸载停止调度和订阅并保留持久化恢复所需数据，不宣称已发请求被撤销。

## 自动化验证

必须覆盖真实 runtime/store/scheduler + controller + UI，而非仅 command 构造器：空 Record、新建取消/校验/重复点击、unknown Create 重启原 key重放、v1 迁移、迁移/持久化失败零新请求、损坏存储保留、容量满、不同 profile 隔离、同 Record 更新 pending 时删除被阻止、确认取消、删除成功/失败/409/未知、回收列表独立查询和分页、恢复使用删除后的 revision、重复撤销、恢复后不命中 Filter、Detail/Map/Cluster 失效、其他 Record 仍可保存、destroy 后 applied 不写旧 UI。

# Devin SWE2 开发工作流

从 [P1.5 总要求](./README.md) 和 [状态表](./status.md) 开始。一个 session 完成一个可验证的纵向切片：设计必要细节、实现、自动化测试、review、更新状态。同一 session 可以继续下一个切片，不需要每一步等待统筹确认，也不跨 session 派发角色任务。

## 启动与推进

1. 读取状态表指定的下一项、对应实现规范和相关源码/测试。记录当前实际 HEAD、工作树已有改动；不依据历史日志中的“当前 main”推断今天状态。
2. 用一个短清单说明本切片覆盖哪些需求 ID、现有实现缺口、要改的模块和验证方式。文档已确定的产品选择直接执行，普通实现细节由 SWE2 决定。
3. 先写能暴露缺口的行为测试，再实现最小生产路径。一个切片包括领域接口、真实 adapter/controller、UI 接线、i18n 和必要存储兼容；不以 callback 占位或 fake-only 结束。
4. 先跑相关测试，完成后跑完整仓库检查。检查失败定位并修复本切片原因；无关已有失败单列证据，不自行标为完成或扩展任务修复其他仓库。
5. 自查 diff 和下方 review 清单，修复发现；代码、相应测试、维护文档放同一交付，不再为每个实现 PR 另开一轮纯证据收口。
6. 更新状态表：需求 ID、实际完成行为、代码/测试位置、执行命令与结果、遗留缺口、下一项。只记录本次真实运行的结果，不复制旧测试数量或旧 CI 结论。

## 建议切片顺序

| 切片 | 需求 | 可合并的完成边界 |
| --- | --- | --- |
| A | F1/Q1、V1/V2 基础 | 复核既有基础，补 View domain/adapter，交付 Grid/Map 共用 Shell、已有 View 切换和显式创建 |
| B | V2 | 重命名/复制/删除/回收列表/恢复/配置修复，统一 View 写入协调及错误恢复 |
| C | V3 | 字段查询能力、嵌套 Filter、多字段 Sort、Search 和 generation/cursor 失效；生产 UI 可操作 |
| D | V4/V5 | 显示面板、宽度、冻结、行高、键盘/单 Cell 剪贴板与稳定 Detail 导航 |
| E | M1/M2 | 真地图预览、条件化打开、Cluster 标题/导航、Map Filter/配置协调 |
| F | R1/R3 | 队列兼容迁移和新操作追踪，生产新增 Record 完整链路 |
| G | R2/R3 | 删除/回收/恢复/撤销、跨 Leaf 写闸门、Grid/Map/Detail 失效 |
| H | Q2 与全量回归 | 补齐 Gallery 状态，逐项映射需求到生产代码和测试，检查通过后完成 P1.5 |

切片是依赖顺序而非固定 PR 数。可以合并很小的相邻切片，或把复杂 F 拆成兼容迁移和新增两个可运行步骤；拆分后仍必须追踪剩余生产行为，不将基础接口交付当完整功能。Gallery fixture 随各切片添加，H 只补齐覆盖，不等到最后重写 UI。

## Q2：组件 Gallery 和测试规范

实现一个开发专用的 DOM Gallery 入口，放入现有测试/开发目录，用同一套生产组件和 `InMemoryLoomTableClient` 组装。无需新增公共产品页面或引入 Storybook/框架。README 写明本地调用方式；生产插件构建不包含 fixture 数据、测试按钮或调试凭据。

Gallery 可由测试挂载相同场景工厂，并支持本地开发查看。验证调用真实组件，不另画一套展示 UI。必要的宿主能力通过 typed fake 注入；定时器和请求结果可控，不需要真实 Server/Obsidian/公共地图。

最低场景：

- 原生 Button/Input/Select、配置浮层/窄布局 Sheet：默认、disabled、pending、error、focus、取消。
- 十类 Field：Unset、null、自然空值、有效/无效、长文本/长文件名、多选溢出、deleted/unknown option。
- Grid Cell/Detail：editing、dirty、saving、saved、error、conflict、offline，含 IME、焦点回退、草稿导航。
- View Shell：Grid/Map、多 View、同名、无 View、已删除 View、配置失效、保存冲突。
- Filter/Sort：草稿、已应用、取消、空结果、嵌套边界、不可用 operator。
- Map：loading、ready、无坐标、不可渲染、Provider 配置缺失、瓦片失败、Cluster 空/多页/过期、预览开闭。
- 生命周期：Create pending/未知、Delete 确认/失败、deleted readonly、Restore/Undo、跨导航仍在保存。
- Light/Dark token 环境、缺失变量 fallback、320/600/1024px 容器样式分支、长内容、reduced motion。

测试以用户结果为主：DOM 角色/文本/焦点/禁用状态、实际请求字段、返回值回写、无多余请求、资源释放、顺序与身份隔离。不用整页快照或断言私有字段代替行为；只在需要证明真实问题时新增测试，避免重复现有覆盖。

jsdom 不提供真实布局：虚拟化和冻结偏移用共享计算逻辑/受控尺寸测量的单元测试验证，DOM 测试验证样式与语义接线，CSS 检查验证命名空间/token/断点。报告为这些自动化检查通过，不声称真实桌面像素效果已验收。

## 检查与交付

运行环境以 `package.json`、锁文件和 CI 为准，目前 Node.js 24、pnpm 11.16.0。已有依赖可直接运行，首次安装使用锁文件。

```text
pnpm install --frozen-lockfile
pnpm check
git diff --check
```

`pnpm check` 包含 format、lint、typecheck、test:run、api:check、build。本期合同未升级，因此固定 OpenAPI、source.json 和 generated transport 应保持不变；`api:check` 当前只比较生成类型，不等于已经核验快照来源，应额外检查这些文件的 diff。不要为通过检查自动运行 api:sync 或更新来源 SHA。

只格式化本次修改的文件，不用 `pnpm format` 重写全仓库。纯文档变更使用格式、链接/引用、合同与差异检查；不为文档编写业务测试或谎称完成代码验证。

最终 review 必须回答：

1. 每个本切片需求是否经过真实 Plugin composition root 接线？是否仍有只声明方法、未传 callback 或仅 fake 支持的地方？
2. 完整 View config 是否保留未改成员？两种 409 是否正确区分？Create/Restore/Delete 的 key、revision 和未知结果是否正确？
3. 读请求乱序、切换 profile/View、dispose、旧 finally、队列恢复是否会写错上下文？已发送写入结果是否仍被持有？
4. Filter/Sort/Projection 是否由 Server 执行？行高/宽度/冻结是否只属于展示？隐藏列、完整 Detail、pagination 是否符合合同？
5. 草稿、失败、Conflict 是否可恢复且不误报 Saved？离线是否零新写入？无障碍与 en/zh-CN 是否覆盖新入口？
6. 变更是否只涉及本切片？旧持久化数据是否兼容？测试是否证明关键失败路径而非只证明成功调用？

远端 GitHub 操作遵循工作区规则：使用可用的 GitHub connector，失败则报告并保留本地成果，不自动退回 gh/git push；本地 git 仅用于读取状态/diff/历史。独立 Devin 环境若缺少 connector，记录具体交付阻塞，不假称已开 PR、通过 CI 或已合并。普通实现、测试和本地文档更新继续完成。

PR 描述只写问题、结果、需求 ID、关键实现取舍、验证和剩余项；遵循仓库 CONTRIBUTING 的分支/PR 规范。创建 PR、合并、发布分别记录真实状态，阶段代码完成不要求发布 Release 或安装用户 Vault。状态表不得要求开发者先反复修正远端提交历史才能继续写代码。

## 阻塞与交接

只有缺失产品决定或固定合同确实无法表达需求时提出具体阻塞：需求 ID、冲突条款、最小实例、已排除原因、建议选择。不要把常规模块拆分、测试 seam、无真实桌面环境作为待批准问题。

若需要新 session，只更新状态表后接续；不创建 orchestrator/reviewer/executor 角色文件，不依赖跨 session 消息。交接说明必须指出下一处可直接动手的代码/行为，不写“等待进一步审计”。

## 可直接交给 Devin 的启动指令

> 在 LoomTable Obsidian Plugin 仓库完成 P1.5。先读 docs/p1.5/README.md、workflow.md、status.md，再读当前切片的实现规范和相关源码/测试。从状态表下一项开始，复用已有能力，按纵向切片完成生产接线、测试、review 和状态更新，持续推进全部需求。普通实现细节自行决定；只有明确的产品或合同矛盾才报告。Server/API/固定快照保持不变。按本工作流的自动化检查交付，不执行已经取消的桌面证据流程，不把接口占位当完成，不反复生成旧阶段审计文档。

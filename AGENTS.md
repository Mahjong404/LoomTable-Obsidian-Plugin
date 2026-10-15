# LoomTable Obsidian Plugin — 仓库内规则

当前阶段（P1.6）范围见 `docs/p1.6/README.md`。独立克隆本仓库可直接按下列入口恢复，不要求同级工作区或本地研究。

## Agent 操作 SOP

新 Agent（包括 DSH、Codex）开始任务先读 `docs/agent-ops/README.md`，再按工作类型读取对应 SOP；产品规范与状态仍以原权威入口为准。以下硬约束继续生效。

## 本地 TODO 收集与阶段规划（强制）

- 用户新提出的 Bug、交互、视觉、性能、技术债或产品建议**不自动构成本轮开发授权**。先核对已有稳定 ID、判断归属和优先级、预计 Wave/阶段、依赖与验收条件，登记到 gitignored `docs/local/maintenance/todo.md`。维护 Session 已建立此唯一的本地 TODO 台账；**即使可以顺手修，也必须先登记，再实施并依据证据标 Done**。
- 记录来源、日期、截图在本地的可定位路径、复现/期望、Owner/PR、阶段、状态（Todo/Planned/In Progress/Blocked/Done/Deferred）、代码与 Figma 的 Done 门槛；不能仅凭测试通过关闭需要 Figma 更新的条目。UI-026～UI-031 已在本地台账，沿用 ID，不另建竞争列表。
- 每次规划新阶段先读本地 TODO、正式 Wave 状态、任务合同及 API Gate，挑选本阶段真正获授权的条目；其余保留等待，不擅自扩大当前 PR。若新 Clone 取不到 gitignored 台账，明确说明缺口并向维护者取得拷贝，不能把私有内容复制入 tracked Git 文档。
- 跨 Plugin/Server 的任务在各仓库本地 TODO 分别记录并引用关联 ID；本地维护清单不替代正式产品规范及唯一 Wave 状态。

## Wave 1.5 实施入口

涉及 Wave 1.5 开发/交接，先读 `docs/wave1.5/README.md`、`status.md`、`devin-plugin.md` 及目标任务卡。长期视觉/交互在 `docs/ui/`，编辑器所有权在 `docs/architecture/field-editor-lifecycle.md`；计划不复制这些规范。按明确授权交付一个纵向切片，更新唯一 status/traceability。当前 API 支持的 UI 先做，API-dependent 部分按 `api-boundary.md` 等待 Server 合同/固定 commit/能力验证，普通 UI 不同步 API。

## UI/UX 工作入口

涉及界面、交互、样式或组件的任务，先读 `.agents/skills/loomtable-ui-design/SKILL.md`（项目级编排 Skill：设计优先级、文档路由、specialist 调度、review checklist），再按路由表读 `docs/ui/` 正式规范。Skills 目录结构与第三方溯源见 `.agents/skills/README.md`。

## 验证命令

- 测试：`npx vitest run`（全量）；`npx vitest run tests/ui/<file>`（定向）
- 类型：`npx tsc --noEmit`；格式：`npx prettier --check .`（写：`--write <file>`）
- Lint：`npx eslint src tests`（0 error 为门禁；warning 为存量风格项）
- 合同：`npm run api:generate` 后 `openapi/` 与 `src/generated/transport.ts` 应零 diff
- 构建：`npm run build`（esbuild → `main.js` + `styles.css`）

## Figma 读写：仅限 Figwright（强制）

- Figma 的读取与写入（节点、变量、样式、组件、导出、修改与复核）**必须使用已安装的 Figwright plugin**；**禁止官方 Figma MCP**，不得私自改用其他 Figma MCP、浏览器/API 或旧截图冒充当前设计事实。
- 访问前核对文件/节点/Variant 和当前批准版本。Figwright 不可用时停止需要 Figma 读写的步骤并明确标记 Not Verified，不得猜测、伪造数据或以工具不可用为由修改设计合同。
- 正式文档/仓库不出现竞品名及链接；研究仅存 gitignored `docs/local/`。

## Obsidian CDP：使用现有可见 qa-vault（强制）

- Obsidian UI/CDP 测试、截图和调整只允许在**用户已经存在的 `qa-vault`** 中操作。先查明并确认真实 Vault 路径；禁止新建替代 QA Vault 或对其他 Vault（含用户日常 Vault）安装插件、修改配置、写入测试数据。Plugin 源码/测试代码仍可正常在本仓库改动。
- **禁止无头、隐藏窗口、不可见的后台 Obsidian 进程做 Host QA**。使用实际可见的 Obsidian GUI，通过 CDP 观察/测试。允许直接占用目前打开的 Obsidian；如需开启 `--remote-debugging-port=9223`，可正常关闭当前 Obsidian 并以可见 GUI 重启，再确认打开的是现有 `qa-vault`。退出前处理未保存状态，避免强杀。
- 旧要求“不得重启或重配用户正在使用的实例”在此由用户新授权替代；不要强制创建独立 Profile 或无头实例。CDP/真实 GUI 不可用时，Host QA 标记 Not Verified，Vitest、Gallery、截图模拟均不能冒充真实 Obsidian 验收。
- QA 证据（截图、实际 DOM rect、computed style、操作状态、主题、字体、zoom、bundle SHA）存入 gitignored `docs/local/`；测试结束仅清理本轮临时资源，不影响其他 Vault、进程或用户数据。不得记录凭据、Token。

## Obsidian 语言与本地化（强制）

- Plugin UI 语言必须服从**当前 Obsidian 的有效语言设置**，按既有 i18n 解析/刷新机制工作；不得因 Agent、Fixture 或 QA 方便擅自改为英文。当前用户 Obsidian 语言是**简体中文**，实际 Host QA 必须检查中文。
- 不把中文硬编码为唯一语言；Obsidian 语言变更时需按产品既有协议响应。不得用系统/浏览器/Server 的语言代替宿主语言。确需 QA 切换语言时只能在 `qa-vault` 内进行，结束恢复原设置并核查 UI 文案，新增文本补齐 i18n/回归测试。

## Server 联调与云端资源

- 进行 Server 连接、联调或远程测试前，必须查阅用户私有运维说明：`C:\Personal folder\Server\rainyunMahjong404\server.md`。无法访问时报告缺口，不猜测主机/端口/凭据；不在仓库、报告或日志复制秘密。
- Server 二进制/容器、PostgreSQL、Docker/Compose 和数据库集成/HTTP 端到端测试应在**云端隔离环境**进行；不得在本机启动 Server/数据库/Docker 服务栈。Plugin 的纯单元测试、类型/格式/构建仍可本地执行。
- 云端测试应及时执行；包含 `DROP SCHEMA public CASCADE` 等破坏性测试**只能**指向专用可销毁云端数据库，绝不触碰生产/共享库。创建者需核对并清理本轮临时容器、网络、测试卷、合成数据和进程，不删除其他应用资源、附件和备份。
- Server 代码合并不等于生产部署；Plugin 功能门控以实际 ready、migrationRequired、meta/capability 与发布版本为准，不用 Mock 宣称线上 Gate 可用。

## Codex Subagent 使用限制

- 主 Session 默认 **0 个 Subagent**，自行完成阅读、代码、测试和自审；禁止例行并列启动 Standards/Spec/Implementation 多 Agent 重复审查。
- 单轮任务**最多 1 个**，仅限可说明必要性、有独立可验证价值的任务，且必须显式指定**严格低于主 Session 的模型**；只降低同模型 Thinking Effort 不算。无法确认/指定模型等级时禁止委派，禁止递归委派。
- 交付时说明使用次数及价值；CI 和外部 PR Review 不需 Subagent。集中 Push，避免不必要的 PR/CI 通知，不取消必要质量门禁。

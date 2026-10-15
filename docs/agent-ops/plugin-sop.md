# Plugin 实现与 DSH 交接 SOP

## 恢复工作上下文

1. 在 Plugin 仓库执行只读检查，保留输出：

   ```powershell
   git status --short
   git branch --show-current
   git rev-parse HEAD
   git worktree list --porcelain
   git log -5 --oneline
   git show origin/main:AGENTS.md
   ```

   `origin/main` 只是本地远端跟踪快照；未查询远端不能称最新。PR 开发 worktree、主 checkout 与 main 可能不同，逐一核对。主 checkout 也可能在旧 PR 分支。遇到 dirty 文件先归属，不 reset / clean / stash / 强制切换。共享工作树不能覆盖其他 Agent 的修改。

2. 读 [P1.6](../p1.6/README.md)、[P1.5 工作流](../p1.5/workflow.md)。若 `docs/sessions/status.md` 实际存在，再读其路由；不存在时报告，不创建替代状态表。Wave 工作读 [README](../wave1.5/README.md)、[status](../wave1.5/status.md)、目标 [Task Specification](../wave1.5/task-specifications.md)、[traceability](../wave1.5/traceability.md)、[API Boundary](../wave1.5/api-boundary.md)。历史 Done / Review 和旧测试数不能代替当前验收。
3. UI 工作读项目 [UI Skill](../../.agents/skills/loomtable-ui-design/SKILL.md)，再按其路由进入 DS / HIG / Grid 与 [编辑器生命周期](../architecture/field-editor-lifecycle.md)。当前用户任务优先；已批准 Figma 是当前基线，可通过明确 Design Delta 迭代。
4. 明确一个纵向任务：Current / Expected、消费者、允许文件、禁止区域、状态与 ownership、API 能力、验收和停止条件。未知的六项或其他待办从协调器取得稳定 ID，不自己复制主 TODO。

## 生产组件与数据所有权

先读 [Loom UI API](../ui/loom-ui.md) 及实际导出。已有 `src/ui/loom-button.ts:createLoomButton`、`toolbar-toggle.ts:createToolbarToggle`、`context-menu.ts:openContextMenu` 与 owner-aware close。`reserveBusySpace` 是 Button 创建选项，不是独立函数。复用生产 Factory、Token 与 mount/update/dispose；禁止复制 DOM/CSS 实现。Field、Query、Palette 是领域 Pattern，不假定已有通用 Popover Factory。

Plugin Runtime 保持 Native TypeScript / DOM / Obsidian API；Vue 仅为 VitePress 文档外壳，不引入 React/Vue Runtime 或未经批准依赖。Gallery / VitePress 挂载同源组件。真实消费者集成是交付条件，Demo 不等于产品完成。

Controller / Durable Mutation Queue 拥有已接受操作、CAS、Replay 与 Unknown Outcome；UI 只拥有未接受草稿、DOM、焦点、监听器和展示状态。Context Switch / Dispose 不能发起旧 queued intent；普通关闭按领域合同处理。不要为了视觉改写 Controller、Client、Queue 或 Grid 虚拟化架构。

## 本地门禁

先检查 `node --version`、`pnpm --version` 与 `package.json`；当前要求 Node >=24、pnpm 版本以 `packageManager` 为准。依赖安装/工具下载需遵守当前权限与锁文件，不能默认安装另一套工具链。以下命令从正确 Plugin checkout 执行：

```powershell
pnpm test:run -- tests/ui/<相关测试文件>
pnpm test:run
pnpm typecheck
pnpm lint
pnpm format:check
pnpm api:generate
git diff --exit-code -- openapi src/generated/transport.ts
pnpm build
pnpm gallery
pnpm docs:build
```

占用较高的 Windows 环境可显式用 `pnpm test:run -- --maxWorkers=2`，记录选择；不增加 timeout 掩盖失败。定向先证明 RED→GREEN，再全量。Lint 比较同基线 warning 净变化，0 error 为门禁，不重构无关文件追求零 warning。API 只生成，不执行 `api:sync`；固定合同零意外 diff。三类构建分别是生产 Plugin、Gallery 与 VitePress。文档切片只跑适用的格式/链接/文档构建，说明未运行产品测试的原因。

## Server / 凭据 / Gate

访问 Server 前先读私有 `C:\Personal folder\Server\rainyunMahjong404\server.md`；不可读时报告，不猜连接。禁止本机启动 Server、数据库或 Docker 服务栈；联调用获授权的云端隔离环境。秘密只在既有 SecretStorage/运维授权通道内使用，不打印、不写日志/截图/研究文件、不提交 Vault 数据。不能自动从其他 Vault 取凭据。

以固定 OpenAPI、实际部署版本、ready / migrationRequired / capability 和 Plugin 接入共同判断 Gate。G1/G6 已有桥接不代表 G2–G5 生产已部署；Server 合并、部署、能力实测、Plugin Integration Ready 分开记录。未经批准 API 不做假持久化、两请求模拟原子操作或伪可用 UI。不修改 Server/OpenAPI pin，除非明确任务授权。

## DSH 实施与交付

DSH 先列当前可调用工具和可读 Skill，核对命令路径；缺工具不等于可自行换工具。定位目标源码、真实消费者与相关测试；写最小复现，按批准规范窄实现，运行上述适用门禁与 Host QA，自审 diff、权限和资源清理。

Git 查询/提交/推送按当前 AGENTS 与用户授权，优先使用已授权的 GitHub connector；缺失或失败先报告，不自动降级本地 git/gh，不自行安装或恢复 connector。需要 CLI 例外时先完成可审阅 diff，再解释限制并取得用户明确授权。集中提交/Push，一个任务一条主要 PR，不反复 rerun CI，不 force push。C 未验收工作不可混入独立 SOP/其他任务分支。

交接给用户：任务 ID、源码/基线 SHA、修改文件、测试命令与结果、Host/Figma 证据、Not Verified、API 状态、残留资源/风险和下一任务所需接口。只更新原唯一状态与 Traceability；未获用户视觉批准不能标 UI Done 或合并。

难度超出能力时，说明具体阻塞、已尝试方案、失败日志与最小下一步，向用户建议是否转 Devin-Claude Opus；不得自动调度、创建 Agent、切换模型或声称完成。默认 0 Subagent，额外限制见 AGENTS。收到新任务前停止扩展范围。

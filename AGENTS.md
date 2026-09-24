# LoomTable Obsidian Plugin — 仓库内规则

当前阶段（P1.6）范围与权威文档索引见 `docs/p1.6/README.md` 与工作区根 `../AGENTS.md`，本文件只登记仓库级的验证方法。

## UI/UX 工作入口

涉及界面、交互、样式或组件的任务，先读 `.agents/skills/loomtable-ui-design/SKILL.md`（项目级编排 Skill：设计优先级、文档路由、specialist 调度、review checklist），再按路由表读 `docs/ui/` 正式规范。Skills 目录结构与第三方溯源见 `.agents/skills/README.md`。

## 验证命令

- 测试：`npx vitest run`（全量）；`npx vitest run tests/ui/<file>`（定向）
- 类型：`npx tsc --noEmit`；格式：`npx prettier --check .`（写：`--write <file>`）
- Lint：`npx eslint src tests`（0 error 为门禁；warning 为存量风格项）
- 合同：`npm run api:generate` 后 `openapi/` 与 `src/generated/transport.ts` 应零 diff
- 构建：`npm run build`（esbuild → `main.js` + `styles.css`）

## Server 环境

- 正常开发与验证环境使用远端服务器上长期运行的 LoomTable Server（Docker 部署）；部署与连接信息以 `C:\Personal folder\Server\rainyunMahjong404\server.md` 为准，敏感细节不复制进本文件。
- 不要默认在本机创建 LoomTable Server / 数据库等 Docker 环境。
- 若某项验证确实必须临时启动本地 Docker，先明确用途；结束后检查并清理本次创建的 containers / networks / volumes，不留遗留测试资源；不得触碰其他项目的 Docker 资源。

## Obsidian 真机审计（CDP）

UI 观感/交互的核验走 Obsidian 内嵌 Chromium 的 DevTools 协议：

1. 启动 Obsidian 带调试端口：`Obsidian.exe --remote-debugging-port=9223`。
2. 用 `docs/local/ux-followup-2026-09-19/cdp.mjs` 驱动（Node ≥24，零依赖）：
   `node cdp.mjs list | eval "<js>" | shot <name> | hover/click/rclick "<selector>" | key <k> | type "<text>" | emulate <w> <h> | emulate 0 0`
3. 鉴权探测服务端：页内 `app.secretStorage.getSecret('loomtable-server')` 取 token + `requestUrl()` 发请求（token 不出页面）。
4. 证据存 `docs/local/<audit-dir>/shots/`；`docs/local/` 已 gitignore，审计产物不入库。

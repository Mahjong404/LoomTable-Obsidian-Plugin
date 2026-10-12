# LoomTable Obsidian Plugin — 仓库内规则

当前阶段（P1.6）范围见 `docs/p1.6/README.md`。独立克隆本仓库可直接按下列入口恢复，不要求同级工作区或本地研究。

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

## Server 环境

- 正常开发与验证环境使用远端服务器上长期运行的 LoomTable Server（Docker 部署）；部署与连接信息以 `C:\Personal folder\Server\rainyunMahjong404\server.md` 为准，敏感细节不复制进本文件。
- 不要默认在本机创建 LoomTable Server / 数据库等 Docker 环境。
- 若某项验证确实必须临时启动本地 Docker，先明确用途；结束后检查并清理本次创建的 containers / networks / volumes，不留遗留测试资源；不得触碰其他项目的 Docker 资源。

## Obsidian 真机审计（CDP）

UI 观感/交互的核验走 Obsidian 内嵌 Chromium 的 DevTools 协议。`docs/local/` 下的 CDP driver 是**可选本机工具、已 gitignore**——干净克隆不依赖它；宿主验收也可走本节末尾的正式手动 QA 方法。

1. 在隔离测试 Vault 中启动独立 Obsidian 实例（不得重启或重配用户正在使用的实例）：
   `Obsidian.exe --remote-debugging-port=9223`。
2. 若本机存在 `docs/local/ux-followup-2026-09-19/cdp.mjs`（Node ≥24，零依赖），可驱动：
   `node cdp.mjs list | eval "<js>" | shot <name> | hover/click/rclick "<selector>" | key <k> | type "<text>" | emulate <w> <h> | emulate 0 0`
3. 鉴权探测服务端：页内 `app.secretStorage.getSecret('loomtable-server')` 取 token + `requestUrl()` 发请求（token 不出页面，绝不写入仓库或报告）。
4. 证据存 `docs/local/<audit-dir>/shots/`；`docs/local/` 已 gitignore，审计产物不入库。

正式手动 QA（无 CDP 时的等效验收路径）：构建 `npm run build` 后在隔离 Vault 中启用插件，逐项走对应任务卡的验收清单（菜单开关/重复触发/Outside/Escape/焦点恢复、Field Editor 成败/失败保 draft、双主题、窄 Pane、键盘/指针、Reduced Motion、组件卸载清理、跨 Pane 菜单隔离），结果与限制写入 `docs/wave1.5/status.md` 的 Checks/Host QA 列；Vitest/jsdom 结果不得冒充宿主验收。

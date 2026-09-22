# `.agents/skills/` — 项目级 Agent Skills

本目录是 LoomTable 的项目级 Agent Skills（Devin/third-party skills 标准：`<skill>/SKILL.md` + 可选 `references/`）。它只覆盖 **UI/UX 设计工作**；产品规范仍在 `docs/ui/` 与 `docs/p1.5/`。

## 结构与优先级

```
loomtable-ui-design   ← 最高优先级：项目权威 / 编排层 / review 流程
    ├─ ux-designer        specialist：交互、IA、数据表格、可访问性
    ├─ opendesign         specialist：复杂界面的方向探索（产出入 docs/local/）
    └─ frontend-design    specialist：视觉打磨（只能在既有体系内 refinement）
```

规则：任何 specialist 的默认建议与 `loomtable-ui-design` 或 `docs/ui/` 冲突时，LoomTable 规则胜出。调度关系详见 `loomtable-ui-design/SKILL.md`。

## 使用场景速查

| 场景 | 调用 |
|---|---|
| 普通 UI feature（字段编辑器、面板、网格交互……） | loomtable-ui-design + ux-designer |
| 复杂新界面 / 需要比较多个方向 | loomtable-ui-design + opendesign + ux-designer |
| 交互已正确，只差视觉打磨 | loomtable-ui-design + frontend-design |
| UI 改动 review | loomtable-ui-design（checklist）+ ux-designer |

## 第三方 Skills 溯源

| Skill | Upstream | 版本 / commit | 取证日期 | License | 本地适配 |
|---|---|---|---|---|---|
| `ux-designer` | [szilu/ux-designer-skill](https://github.com/szilu/ux-designer-skill) | `da9e9d0` (2026-08-14) | 2026-09-23 | MIT（`LICENSE` 已附） | **无** — `SKILL.md` 与 24 个 `references/` 全量 verbatim |
| `opendesign` | [manalkaff/opendesign](https://github.com/manalkaff/opendesign) | `cecd9bb` (2026-06-27) | 2026-09-23 | MIT | **衍生 / 适配（derived，非 verbatim）** — 基于 upstream 核心 workflow 针对 LoomTable 裁剪重写：产出目录改为 `docs/local/ui-exploration/`、移除未 vendored 的姊妹 skill 调用与 viewer/manifest/preview 流程、锚定既有设计系统。**不可用直接覆盖 `SKILL.md` 的方式升级**——须重新 diff upstream core workflow 后手工合并适合 LoomTable 的变化（适配点见该文件顶部声明） |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | `34040c9` (2026-09-10) | 2026-09-23 | 见 `LICENSE.txt` | **Upstream-derived** — upstream 正文完整保留，仅前置 LoomTable 本地作用域/政策声明（frontmatter 一行 + 9 行适配块；边界在文件内有明确标记，声明以下为上游原文） |

### 升级第三方 Skill 的流程

1. 对照上表 commit 拉取上游新版 diff。
2. 按 skill 分别处理：
   - `ux-designer`：可直接覆盖上游文件（无本地适配）。
   - `frontend-design`：可覆盖上游文件，随后重贴本地适配头（frontmatter 行 + `Local adaptation` 声明块，照抄现有版本即可）。
   - `opendesign`：**不得直接覆盖**。重新阅读 upstream core skill 的 workflow diff，对照 `opendesign/SKILL.md` 顶部的适配声明，手工合并适合 LoomTable 的变化。
3. 更新本表 commit 与日期。
4. 本地适配原则：第三方 skill 的通用能力保持原状；LoomTable 专属规则只放 `loomtable-ui-design`。仅当上游默认规则必然导致本项目设计错误时才做最小修改，并在文件顶部声明。

## 维护边界

- Skills 目录不引入 runtime 依赖；仅供 Agent 阅读。
- 正式设计规范的单一事实源是 `docs/ui/`；Skill 中不复述规范细节，只做路由与规程。发现 Skill 与 docs 矛盾时以解决矛盾为先，不留两套说法。
- 探索产物（opendesign 的 HTML mockup、竞品研究笔记）一律进 `docs/local/`（gitignored），不进正式文档与源码。

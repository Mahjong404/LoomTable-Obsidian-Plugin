---
name: loomtable-ui-design
description: LoomTable 项目 UI/UX 工作的最高优先级编排 Skill。任何涉及界面、交互、样式、组件、响应式或可访问性的任务都应先读本 Skill 确定规则、要读的正式规范、以及是否调度 ux-designer / opendesign / frontend-design 三个 specialist skill。
---

# LoomTable UI Design — 项目级编排 Skill

本 Skill 是 LoomTable 所有 UI/UX 工作的**操作层入口**：它定义设计优先级、不可协商的实现约束、文档路由、specialist skill 调度规则和 review 流程。它不复制产品规范 —— 正式规范在 `docs/ui/` 与各特性文档中，本 Skill 告诉你**什么时候读哪份、读完按什么顺序裁决**。

## 定位与优先级

```
            ┌─ ux-designer      （交互/IA/可访问性专家）
loomtable ──┼─ opendesign       （复杂界面的方向探索）
-ui-design  └─ frontend-design  （视觉打磨 specialist）
```

- 本 Skill 与 `docs/ui/` 正式规范是同一套体系的两层：**docs = 产品设计知识（说什么）**，**Skill = Agent 操作规程（怎么做、先读什么、如何裁决）**。
- 三个 specialist skill 是通用专家工具。它们的默认建议与 LoomTable 规则冲突时，**LoomTable 规则永远胜出**。
- 规范冲突裁决顺序：当前产品需求（用户当次明确要求）→ `docs/ui/` 正式规范（HIG 与 design-system 为通用基线，grid/map 等特性规范在其范围内更具体）→ 本 Skill → 现有实现 → 外部研究材料。发现 Skill 与 docs 矛盾时必须当场修正其一，不允许并存两套说法。

## 设计优先级（从高到低）

1. **交互正确性** — 行为符合特性规范，状态机完整，不造假成功态。
2. **数据完整性** — 指 UI 可见的数据安全与状态正确：Server 为事实源、乐观更新可回滚、冲突显式呈现、危险操作防护、防静默丢失、防半成品状态污染已提交数据。**不授权**自行重构存储、schema、同步或后端数据层架构。
3. **宿主一致性** — 自然存在于 Obsidian 中，不像嵌入的独立软件。
4. **信息密度** — 数据区保持高密高效，不为"好看"稀释密度。
5. **多维表格工作流效率** — 键盘/批量/就地操作优先于表单化流程。
6. **可访问性** — 键盘可达、焦点可见、非颜色单通道、reduced-motion。
7. **响应式/窄面板可用性** — 按容器宽度适配，含 Obsidian 多栏/侧栏场景。
8. **视觉打磨** — 层级、间距、对齐、反馈的精致化。
9. **装饰性美观** — 最低优先级，永远不得凌驾于交互正确性与可用性。

装饰永远不凌驾于前七项。当"更好看"与"更正确/更高效"冲突时，选后者。

## 不可协商约束（每次 UI 任务都适用）

### 架构边界

- **native DOM + TypeScript + Obsidian API**。不引入 React/组件库/UI framework/新 runtime 依赖；未来评估定位类库（如 floating-ui）需单独提出并获批。
- 宿主控件优先：Modal、Menu、Notice、Setting、Command、`setIcon` 等直接用 Obsidian API；宿主控件明显不胜任复杂数据场景（Grid 单元格编辑、Filter Builder、字段配置、Record Detail 等）时才自建 Loom 组件。
- 样式唯一入口 `styles.css`，`.loom-root` 作用域。新 UI 用 `--loom-*` token + `.loom-*` 类名；**禁止**全局元素选择器（`button`/`input` 等）、禁止直接消费 `--background-*` 等 Obsidian 变量（必须经 `--loom-*` 映射）、禁止 `transition: all`、禁止硬编码颜色/字体。

### 状态与反馈

- 组件状态可观测（`data-state` / 专用类名）；必备状态集合见 `interaction-hig.md`。loading/empty/error/readonly/dirty/conflict/offline 不得遗漏适用项。
- 状态不以颜色为唯一通道；文本/图标/位置至少双通道。
- 保存/同步状态措辞统一（见 HIG 文案节）；不得出现"假装成功"的视觉态。

### 键盘与焦点

- Enter/Escape/Tab/箭头/复制粘贴/Delete 的行为按 HIG 与各特性 spec 执行；新增交互面必须给出焦点进入、循环、恢复路径。
- 焦点环可见；不允许键盘陷阱；浮层关闭后焦点回到触发源。

### 响应式

- 布局适配按实际 **container/pane 可用宽度**分档（宽工作区 / 常规面板 / 窄面板 / 侧栏级 / 移动视口）；不得用 viewport width、设备名或宿主类名（如 `is-phone`）推断面板可用宽度。
- 环境/交互能力适配（mobile host context、pointer/hover、touch、safe-area、`prefers-reduced-motion` 等）是合法且独立的另一类响应，完整规则以 HIG 容器响应式节为准，此处不重复清单。
- 桌面 Popover ↔ 窄布局 Sheet/抽屉的切换走**单一 seam**（共享判定），逐面板 opt-in；禁止各面板自带断点分支。
- 触屏不依赖 hover 作为唯一路径：长按/显式手柄补齐右键与拖拽能力。

### 图标与文案

- 系统 UI 图标走 Obsidian/Lucide；用户可选图标走 Tabler；领域专属才自绘 SVG。任何人不得随意更换图标语言。图标三层来源与原则的规范性定义见 `design-system.md` 图标节。
- 一切面向用户的字符串走 i18n（`src/i18n/`），禁止硬编码文案。

### 验证

- 新组件/新状态必须进 Component Gallery（`tests/gallery/`），覆盖明暗主题、长内容、窄容器、键盘、触屏维度。
- 视觉/交互核验可走 Obsidian CDP 真机审计（见 `AGENTS.md` 验证命令节）。

## 文档路由表 — 任务 → 必读

| 任务类型 | 必读 | 选读 |
|---|---|---|
| 任何 UI 任务（底线） | `docs/ui/interaction-hig.md`、`docs/ui/design-system.md` 对应节 | `docs/ui/README.md`（文档架构与规范层级） |
| Grid 行为/性能/选择/编辑/虚拟化 | `docs/ui/grid-spec.md`、`docs/p1.5/view-grid.md`、`src/ui/readonly-grid-renderer.ts`、`src/ui/table-shell.ts` | `docs/architecture/detailed-design.md` |
| Filter/Sort/Display/搜索面板 | `interaction-hig.md` 浮层与查询节、`docs/p1.5/view-grid.md`、`src/ui/filter-builder.ts`、`sort-panel.ts`、`display-panel.ts` | `grid-spec.md` 查询语义 |
| 记录详情/字段编辑/字段渲染 | `docs/p1.5/record-lifecycle.md`、`src/ui/record-detail.ts`、`field-value-editor.ts`、`field-renderer-registry.ts` | `interaction-hig.md` 表单与状态节 |
| View 生命周期/页签/视图管理 | `docs/p1.5/view-grid.md`、`src/ui/loomtable-view.ts`、`table-shell.ts` | `docs/architecture/detailed-design.md` |
| Map | `docs/ui/map-spec.md`、`docs/p1.5/map-location.md`、`src/views/map/`、`src/maps/` | `interaction-hig.md` 状态节 |
| 新组件/新 primitive/新状态 | `design-system.md` 全部、`styles.css` 相关块、`tests/gallery/` | `frontend-design`（打磨建议） |
| 视觉打磨/层级/间距/密度 | `design-system.md` + 本 Skill 反模式节 + `frontend-design` | `ux-designer` 视觉参考 |
| 交互/IA/表单/键盘/可访问性疑难 | `ux-designer` 对应 references（21-data-tables、03-accessibility、06-interaction-design、07-forms-and-inputs 等） | `interaction-hig.md` |
| 复杂新界面方向未定 | `opendesign` 产出探索稿（`docs/local/ui-exploration/`，不入库） | — |
| i18n/文案 | `interaction-hig.md` 文案节、`src/i18n/` | `ux-designer` 09-ux-writing |

**先读代码再提方案**：任何改动建议前必须打开相关 `src/ui/` 实现确认现状；规范描述与实现不一致时以"规范是否应该改"为显式议题提出，不静默按任一方执行。

## Specialist 调度

- **`ux-designer`**（默认搭档）：交互设计、IA、数据表格 UX、键盘、焦点、表单、搜索、响应式、空/加载/错误态、渐进披露、可访问性审查。普通 UI feature = 本 Skill + ux-designer。**按任务只加载最少相关 references**（如 Grid 任务取 21-data-tables、06-interaction-design、03-accessibility），不默认加载全部 24 个。
- **`opendesign`**（探索器）：新复杂 surface、多种布局/IA 方向需要比较、对现有 UI 提替代方案。产出为 `docs/local/ui-exploration/` 下 HTML 探索稿，**决策与规格仍归 docs/ui/ 与本文档**。复杂界面 = 本 Skill + opendesign（探索）+ ux-designer（校验）。
- **`frontend-design`**（打磨师）：功能与交互已正确，只差层级/间距/密度/排版/对齐/图标/微反馈/空错态呈现。功能正确且缺打磨 = 本 Skill + frontend-design。它只做 refinement，不得重定义视觉语言、不得引入 token 体系外的颜色/字体/图标。

## 工作流

### 设计/实现任务

1. 按路由表读规范 → 2. 读现状实现 → 3. 需要时调度 specialist → 4. 产出方案并自报对优先级表的取舍 → 5. 实现（遵守不可协商约束）→ 6. 更新 Gallery/i18n/样式 → 7. 按 Review checklist 自检并跑 `pnpm check` 相关子集。

### Review 任务（评审他人或自己的 UI 改动）

按下方 checklist 逐项过；发现 spec ↔ 实现矛盾时明确指出"规范错"还是"实现错"及建议修法，不和稀泥。

### Review checklist

- [ ] 行为符合对应特性 spec（编辑流、查询语义、状态机）
- [ ] 键盘全套：导航、提交/取消、焦点恢复、无键盘陷阱
- [ ] 状态覆盖：default/hover/focus/active/disabled/loading/readonly/dirty/error/conflict/offline 中适用项齐全
- [ ] 非颜色单通道；role/aria 正确；reduced-motion 生效
- [ ] 容器宽度各档可用；窄面板/移动降级符合 HIG；popover↔sheet 走单一 seam
- [ ] 明暗主题均验证；无硬编码颜色；token/namespace 合规
- [ ] 乐观更新可回滚；冲突/错误如实呈现；无伪造成功态
- [ ] 用户可见字符串走 i18n；术语与 HIG 动词表一致
- [ ] 新组件/新状态已进 Gallery；必要状态在明暗主题下截图核验
- [ ] 宿主集成正确：该用 Obsidian 原生控件的地方没有自造轮子
- [ ] 无新 runtime 依赖；无框架引入；diff 不含无关重构

## 反模式（明确禁止的产物）

- generic SaaS dashboard / landing-page 化界面；大而空的卡片堆；过度留白与超大标题。
- 过度圆角/阴影/渐变/玻璃拟态/装饰性背景；无语义目的的动效。
- shadcn/Material/Fluent 等外来视觉身份的默认样式移植。
- 硬编码颜色字体、绕过 `--loom-*`、全局选择器、`transition: all`。
- 为"原生感"把复杂数据交互降级为不胜任的宿主控件；反之为"现代感"把宿主该管的 Notice/Modal/Menu 自造。
- 用 viewport 断点、设备名或 `is-phone` 类名推断面板可用宽度（环境/交互能力适配是合法例外，见 HIG）；各面板各自判宽。
- 未经确认的大规模重写（Grid 重构、框架迁移、组件库引入）；把研究素材中的功能直接实现。
- 在正式规范、代码注释、commit 中以竞品/外部产品名作为设计依据（研究笔记限 `docs/local/`，正式产物只写 LoomTable 自己的规则）。

## 边界

本 Skill 管辖 UI/UX 决策与 review。不改数据模型、不改 OpenAPI 合同、不动 Server 仓库、不因 UI 工作顺手重构无关模块。发现实现偏离规范时，默认记录并报告（最终报告/审计清单），不擅自大修；修法明确的小偏离可与本次任务一并处理但需在提交说明中点出。

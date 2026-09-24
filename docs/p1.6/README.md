# P1.6 阶段：UI/UX 稳定化与打磨

P1.6 是 P1.5（功能交付）与 P2.0（新产品功能）之间的过渡稳定阶段。**本阶段不新增产品功能**；目标是把已有实现收敛到已建立的规范上，并清偿 UI 技术债。

## 阶段目标

- 现有实现与 [docs/ui/](../ui/README.md) 规范（Interaction HIG → Design System → 特性 spec）完全对齐；
- 修复已知 UI/UX 缺陷与观感问题；
- 收敛视觉与交互一致性，提升键盘/焦点/可访问性质量；
- 清理已登记的规范偏离与 UI 技术债。

## 允许的工作

- 修复现有 UI/UX 缺陷、状态/反馈/文案问题；
- 让实现与当前 HIG / Design System / 特性规范对齐；
- 响应式：容器宽度适配、窄面板布局、环境/交互能力适配（规则见 HIG §容器响应式）；
- 键盘、焦点管理、可访问性改进；
- 视觉与交互一致性收敛（组件变体、间距、状态色、控件复用）；
- 既有组件和交互的重构、性能与可维护性优化；
- 已登记规范偏离与 UI 技术债的清理。

## 不属于本阶段

以下改动原则上进入 P2.0 或需另行确认：

- 新的业务能力与产品功能；
- 新字段类型、新 View 类型；
- OpenAPI 合同、数据模型、持久化 schema 的变更（纯修复性对齐除外，需先行确认）。

## 种子工作项

已登记的已知缺口（来自前轮规范修订与本地审计），执行时按优先级切片推进：

- `styles.css` 中承担面板布局判定的 viewport `@media` 迁移为容器宽度判定（已登记规范偏离）；
- 附件预览、危险确认框等缺样式表面；缺失的 Primary 按钮变体；死 CSS 清理（本地审计清单见 `docs/local/style-audit-2026-09-20/` 等，本地材料仅作线索，正式依据以规范为准）；
- CDP 真机观感复核（P1.5 遗留 #9–#12 项）；
- 各会话新增缺口在「当前交接」中登记。

## 权威次序

用户当前要求 → 本文件阶段范围 → [docs/ui/](../ui/README.md) 规范 → [docs/p1.5/](../p1.5/README.md) 实现合同（已交付行为的有效规范）→ 固定 OpenAPI 事实 → 现有代码与测试。

## 验证

沿用仓库门禁：`npx vitest run`、`npx tsc --noEmit`、`npx eslint src tests`、`npx prettier --check .`、`npm run api:generate` 后零 diff、`npm run build`。UI 观感核验按仓库 AGENTS.md 的 CDP 流程执行。

## 当前交接

- 2026-09：阶段定义，P1.5 已交付封存（见 [P1.5 状态表](../p1.5/status.md)）。种子工作项按上节推进；每个会话在此更新最近交接。
- 审计 `docs/local/ux-audit-2026-09-24.md` 确认项实施中（本轮用户授权连续推进全部切片）：
  - ✅ Map：空 Leaflet pane 不再截获 Marker 事件；`ready` 后收起瓦片就绪常驻状态条（loading/error/config 仍可见，ready 保留 aria 播报）。已 CDP 真机验证点击/拖拽/hover，已提交 `3426920`。
  - ✅ 字段浮层焦点与草稿行焦点：Field Editor 打开经 `setTimeout`+有界重试（真实 click 手势窗口期内 `focus()` 会被静默丢弃）；Tab/Shift+Tab 面板内循环；Esc/外点/宿主滚动关闭并恢复稳定触发源；`closed` 幂等与其他面板对齐；`render()` 保留存活 overlay 不再被 `replaceChildren` 摘除；行内新建提交后焦点落到新记录 cell（不可见则回落新增入口，失败粘性恢复草稿），用户主动移焦后异步结果不抢焦点。已 CDP 验证打开聚焦/Tab 圈/Esc 恢复/render 存活/草稿提交落焦。
  - ⏳ 进行中：计数失效、Default View/Display stale、O2 reorder（含 Server）、列头交互重构（单击选列/双击编辑/拖拽重排/分隔线调宽/键盘）、O3 导航两行 + 工具栏 `…` + 容器响应式、Filter 渐进披露、Detail select/date 即选即存。

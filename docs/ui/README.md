# LoomTable UI 文档入口

本目录是 LoomTable UI/UX 的正式规范所在位置。本文说明各文档职责、规范冲突的裁决顺序、以及规范与 Agent Skills 的分工。

## 文档职责

| 文档                                       | 职责                                                                                                  | 不定义                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| [interaction-hig.md](./interaction-hig.md) | 全局交互规范：设计优先级、状态语义、键盘/焦点、浮层、保存/错误/离线、容器响应式、可访问性、文案、验收 | 具体组件视觉细节、CSS 组织 |
| [design-system.md](./design-system.md)     | 视觉与样式体系：视觉基调、Token、CSS 层次、控件分工、图标分层、命名空间、状态表达、依赖策略           | 交互行为与状态机           |
| [grid-spec.md](./grid-spec.md)             | Grid 特性规范：性能与虚拟化、选择/编辑/剪贴板、查询与分页、列与行操作、Grid 状态                      | 通用交互规则（引用 HIG）   |
| [map-spec.md](./map-spec.md)               | Map 特性规范：配置边界、Provider/Renderer/Geocoding、Camera、Attribution、失败行为                    | 通用交互规则（引用 HIG）   |

View 生命周期、记录生命周期等 P1.5 实现规范在 [docs/p1.5/](../p1.5/README.md)；它们是与正式规范同级的实现级合同，不比本目录更通用。

## 规范冲突的裁决顺序

```text
当前产品需求（当次明确要求）
        ↓
interaction-hig.md + design-system.md   （通用基线）
        ↓
grid-spec.md / map-spec.md / docs/p1.5/ （特性规范，可在自身范围内更具体，不得违反通用基线）
        ↓
现有实现
        ↓
docs/local/ 研究材料（仅内部参考，不构成规范）
```

- 特性规范与通用基线冲突时，通用基线胜出，除非该特性文档中已按 HIG「例外与变更」节登记书面例外。
- 规范与实现不一致时，以「规范是否应该改」为显式议题处理：实现反映已确认决策的，修订规范；实现是缺陷的，记录为待办。不静默按任一方执行。
- 规范之间的重复规则应合并到单一来源，其余位置只做指针。发现重复/矛盾/过时条款时顺手修正或登记，不允许两套说法并存。

Approved/Frozen 表示当前开发使用的批准基线，不是永久禁止设计迭代。用户提供新 Figma 或明确变更指令时，以 Design Delta 更新受影响的规范、Traceability、组件和验收；未提出确定变更的部分继续按当前基线实现，不预先猜测新布局，也不自动解锁 API/Future 能力。

## Wave 1.5 实施引用

设计阶段已完成，当前批准的长期视觉规则在 Design System，接受/取消/焦点/Query/Date 与 Future Time 行为在 HIG，Grid 几何/选择/加载在 Grid Spec。技术所有权只在 [Editor Lifecycle](../architecture/field-editor-lifecycle.md)；任务/依赖/验收见 [Wave 1.5](../wave1.5/README.md)，进度只在 [status](../wave1.5/status.md)。

本目录描述目标行为；API-dependent 能力必须按 [API Boundary](../wave1.5/api-boundary.md) 启用，不因视觉批准或规范出现功能就自动扩展 P1.6。Figma authority 链接集中在 [Traceability](../wave1.5/traceability.md)，静态设计不替代 Runtime QA。实施规划引用本目录，不另建平行 UI 规范。

## 与 Agent Skills 的分工

```text
docs/ui/                    = 产品设计知识（规范说什么）
.agents/skills/loomtable-ui-design/
                            = Agent 操作规程（先读什么、如何调度、如何 review）
.agents/skills/{ux-designer,opendesign,frontend-design}/
                            = 通用专家工具
```

- 规范细节只维护在 docs；Skill 不复述规范，只做路由、优先级与流程。
- Agent 执行 UI 任务时以 `loomtable-ui-design` 为入口，再按其中的文档路由表读本目录对应规范。
- 人类开发者直接读本目录即可，无需经过 Skill。

## 术语

术语的单一来源是 [interaction-hig.md 领域术语节](./interaction-hig.md#领域术语)与 Server `CONTEXT.md`。新文档引入新名词前先检查是否已有正式术语。

## 本地研究材料

`docs/local/`（gitignored）存放 UX 审计、外部产品研究与探索稿，仅供内部参考；正式规范不得引用其中内容作为依据，也不得在正式文档中以外部产品名称作为设计依据。

外部视觉比较原件统一保存在 `docs/local/ui-research/`，本目录只保留正式规范。历史日志中的研究路径不构成当前规范入口。

本轮具体设计到代码差异、固定Golden条件与任务入口见 [Wave UI 对齐](../wave1.5/ui-alignment.md)；它记录证据与执行路由，不建立新的DS/HIG或状态表。

已有生产导出、两处实际消费者、mount/update/dispose与Devin复用边界见 [Loom UI 接口](loom-ui.md)。它记录实现接缝，不另建视觉或业务规范。

# Loom UI — 生产接口与 Devin 集成合同

此文记录已有 API；视觉由 [DS](design-system.md)、交互由 [HIG](interaction-hig.md)、业务释放由 [Lifecycle](../architecture/field-editor-lifecycle.md) 定义。当前设计可通过 Design Delta 正常迭代。

## Button / Control

从 `src/ui/loom-button.ts` import `createLoomButton`、`LoomButtonHandle`、`LoomButtonOptions`、`LoomButtonState`、`LoomControlSize`、`LoomButtonVariant`。

| 参数                       | 类型 / 责任                                                           |
| -------------------------- | --------------------------------------------------------------------- |
| label / accessibleLabel    | string；consumer 提供 i18n，accessibleLabel 缺省为 label              |
| size                       | compact / default，默认 default                                       |
| variant                    | quiet / neutral / primary / danger，默认 neutral                      |
| leadingIcon / trailingIcon | UiIconName 或 null，现有 icons.ts；null 移除槽内容                    |
| disabled / busy            | boolean；任一 true 禁止激活；busy 发布 aria-busy                      |
| reserveBusySpace           | 创建时 boolean；异步 consumer 必须 true，初始预留 Loading 槽          |
| onActivate                 | () => void；Promise、错误、世代、CAS/Unknown Outcome 由 consumer 拥有 |

返回 `{ element: HTMLButtonElement, update(Partial<LoomButtonState>), dispose() }`。append element 完成 mount；update 保留按钮与 Label/Loading 槽，更新属性/图标；dispose 幂等释放 click 并移除 DOM，late update/action 无效。只监听 click，Enter/Space 由原生 button 合成激活，禁止再添加第二份键盘 Action。

```ts
const submit = createLoomButton({
  label: localizedSaveLabel,
  variant: 'primary',
  size: 'default',
  reserveBusySpace: true,
  onActivate: () => void saveExistingDomainDraft(),
});
panel.append(submit.element);
// 在既有 singleflight / generation guard 内：
submit.update({ busy: true });
// 有效 owner 的失败恢复：保 draft、显示既有 accessible error，再 busy:false。
// 成功关闭或 owner 失效：
submit.dispose();
```

生产参考为 `field-editor-panel.ts` 的 submitControl：整行宽度、原 Lock/Unlock、失败保输入与 late-owner guard 保持；Renderer Create Record 也消费 factory。示例不是新的保存实现；禁止复制 Field 保存协议或把 Controller 状态塞进 Primitive。纯 icon target、Grid cell、query operand、Choice/Date/Palette 不强行改造成 Button。

## Toolbar Toggle

从 `src/ui/toolbar-toggle.ts` import `createToolbarToggle`、`ToolbarToggleHandle`、`ToolbarToggleOptions`、`ToolbarToggleState`。

创建参数 `label`、可选 `icon`、`onActivate`，以及 controlled `open:boolean`、`count:number`、`accessibleLabel:string`、可选 `disabled:boolean`；返回 element/update/dispose。Open 只表达浮层打开和 trailing Chevron；Active 只由有效 count>0 表达。可同时成立，组件不验证领域条件、不自行保存或打开 Popover。

```ts
const filter = createToolbarToggle({
  label: localizedFilterLabel,
  icon: 'tool-filter',
  open: false,
  count: 0,
  accessibleLabel: localizedFilterLabel,
  onActivate: toggleOwnedFilterPanel,
});
toolbar.append(filter.element);
filter.update({ open: true, count: validRuleCount, accessibleLabel: fullLocalizedName });
filter.dispose(); // Renderer 替换 Toolbar / dispose 时释放。
```

生产参考为 `ReadonlyGridRenderer.#toggleButton`。FilterBuilder 的 `getValidRuleCount()` 与可选 `onDraftCount(count)` 只报告 draft-local 有效 rule；invalid operand/placeholder 不计数，通知不发写入。关闭后的 count 使用 Controller 已持久化 filter。Sort/Display 提供自己的有效计数，不从 aria-expanded 推导 Active。窄 Pane 保留既有标签折叠/overflow规则与完整 aria-label；Toolbar 后代样式不得覆盖嵌套 Field/Query。

## Menu / owner

复用 `src/ui/context-menu.ts` 的 `openContextMenu(options): () => void`、`closeActiveContextMenu(owner?)`、`activeMenuOwnedBy(host)`。可选 `width:number` 用于领域宽度；默认值/clamp 在 DS/HIG。host 必须是稳定 Renderer/Pattern owner，与关闭调用方同一 HTMLElement。新 Menu 关闭旧 Menu，不能跨 Pane 无条件 global close。

items 保持 command / radio / checkbox：checkable 决定 role/aria-checked，checked 决定选择，旧 current 保留 aria-current；command 不变成 radio。Label 占剩余宽度并截断，Leading/Check 使用现有指定 glyph，Check 不改变其他图标 stroke。Portal 复制 owner 计算后的 Loom Token，在祖先主题/样式变化时刷新；observer/document listener 随 disposer 释放。Focus、Outside、Escape、Action 与完整 Menu+Trigger boundary 沿 A 合同。

Field、Filter Values、Palette 保持领域 Pattern，尚无通用 Popover factory。Controller/Queue 拥有已接受 operation；组件只拥有 DOM、监听器与展示状态，dispose 不能启动旧 draft 新写入。Query 普通关闭由有效 owner 显式 flush；Escape/context/unload 取消未接受 intent。

## 样式 / 同源展示

只 import factory 并使用 `styles.css`，不复制 DOM/样式。Token 为 `--loom-control-compact-height`、`--loom-control-min-height`、`--loom-radius-control`、`--loom-radius-floating`、`--loom-control-inline`、`--loom-control-gap`、`--loom-control-icon-size`、`--loom-control-font-size`、`--loom-control-line-height`、`--loom-accent`、`--loom-on-accent`。色彩经 Obsidian 映射，consumer 不硬编码 Figma hex。

Figma：内容6:127、Light Surface6:232 / Dark6:325；Toolbar9:888/898/906及9:931/941/949；Menu13:1841/1868、plain13:1690/1765、checked13:1705/1780、disabled13:1700/1775、danger13:1729/1804。Menu radius6 与 Panel radius8 区分；异步预留 Loading 槽是用户批准适配，见 DS。

`pnpm gallery` 后打开 `tests/gallery/index.html#loom-controls`；`pnpm docs:dev` / `pnpm docs:build` / `pnpm docs:preview` 提供 VitePress 入口。两者都挂载 `tests/gallery/control-showcase.ts` 并直接调用生产 factory；Vue 只负责文档 mount/unmount，Plugin bundle 不含 Vue/VitePress。展示 Light/Dark、两种密度、四角色、四 Toggle 状态、Disabled/Busy、长文本/窄宽度与 Menu 语义；不提供伪持久化。

## Devin 后续边界

固定已集成 B commit，先验证真实消费者，再实施任务卡 C 的完整 Grid Golden。复用上述导出；新行为先给 Design Delta/有限 API 变更，禁止复制另一份组件。Field/Query 领域状态、operation、错误和焦点保持原 owner。API Gate 仍按 api-boundary，不因 B 完成就扩大 G2–G6/Future；已交付 G1/G6桥接保持。

验收分别证明功能、Figma 量尺和 Host；Gallery/Vitest 不能证明宿主。B 不签完整 Grid、Sort/Display新版布局、Map/Record/Date视觉完成，不证明真实 Mobile/touch或生产Server持久化。

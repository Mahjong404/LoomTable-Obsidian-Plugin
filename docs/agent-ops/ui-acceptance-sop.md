# UI 验收与交付 SOP

本流程执行 [UI Alignment](../wave1.5/ui-alignment.md)、[Task Specifications](../wave1.5/task-specifications.md) 与 [Loom UI](../ui/loom-ui.md)，不复制一套 DS/HIG、Golden 尺寸或状态主表。设计可通过明确 Design Delta 迭代；Future/API-gated 不因 UI 截图解锁。

## 建立可复现基线

记录固定源码 SHA/dirty diff、安装 Bundle/CSS hash、Figma 文件/Node/Variant/读取时间与批准来源、Obsidian版本、实际 qa-vault、主题、宿主语言、字体、viewport、Pane rect、真实 zoom、测试数据与滚动位置。旧图的 final/approved 名称不能证明最新批准。

沿当前任务运行 Golden G0–G3，先截图原始问题再截图修复状态。标准 Grid、窄 Pane 320/400/600、双 Pane、Light/Dark、200%真实缩放、Reduced Motion、coarse模拟按任务适用范围核验；实际触屏不可用标 Not Verified。不固定截图高度掩盖 Footer/Viewport 布局。

用完整生产操作场景审查，不能只渲染独立 Button。Figma 节点只用 [Figwright](figwright-sop.md)，宿主只用 [可见 qa-vault](obsidian-cdp-sop.md)。Gallery/VitePress 同源组件证明复用与展示，不能替代实际 Obsidian。

## 量值、状态与数据安全

每项按适用性记录 Current/Expected、Figma几何/Token、实际 rect/computed、差值、根因与最小修复范围：anatomy、height/width/padding/gap/alignment、font/weight/line-height、surface/border/radius/icon、density/state/overflow/z-index/响应式。区分违反批准规则、允许的宿主字体适配与不可避免的渲染差异；主题兼容不能解释错误结构。

同时验证菜单完整 Menu+Trigger focus boundary、跨 Pane owner、Outside/Escape/Action、Overlay释放、Field Pending/Failure/Retry、draft/caret/IME、远距离虚拟行与非零双向滚动、density/frozen/resize、Footer对齐、Grid→Map→Grid、dispose/late-response、closed/open+active count。优先保护未接受编辑，再功能与生命周期，再视觉。不调整 Queue/CAS 或关闭虚拟化掩盖失败。

异步故障注入必须明确标记测试包装而非真实 Server失败；保留实际请求/结果与写入次数，结束恢复。只使用已授权合成 QA数据，不对生产/共享数据做破坏测试。能力缺失展示 unavailable / gated；不假造 aggregate、options 或持久化结果。

## 证据与验收判定

复杂截图/视频/trace/导出/原始 JSON保存在 ignored 本地证据目录；精简结论、稳定 Node/Spec、源码SHA、测试结果与限制记录原 status/traceability 或 PR，正式合同不得把本地证据当作 clone 必需输入。不要提交凭据、Vault配置或构建产物；研究与正式工程资料隔离。

区分 Confirmed Defect、Evidence-backed Risk、Missing Verification、Expected Behavior；明确 C Regression / Incomplete / Legacy Debt / Future/API Gated / Design Decision Needed。没有足够证据不夸大严重级别。缺设计/产品冲突需 Design Delta 和用户裁决，普通有依据问题直接窄修复。

新 HEAD 必须重新执行适用门禁，不能引用旧 green 数字冒充新验证。PR检查与 Review读取当前 HEAD，finding用复现与测试证据关闭；未公开旗标不可访问则 Not Verified。集中 Push，不反复rerunCI，不关闭质量门禁。

交付给用户：前后整页/局部图、Figma对应、实测量值、中文/双主题/窄宽/缩放/滚动结果、功能门禁、Known Gaps、源码/安装SHA、可见测试入口、残留资源与明确下一步。Code Review Passed / CI Green / Host QA Passed / User Visual Approved / Merged 是不同事实；没有用户明确视觉确认不能将当前 C 标 Done 或合并 PR #116。新一轮生产任务以最新授权范围为准。

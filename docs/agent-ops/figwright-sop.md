# Figwright 设计操作 SOP

仅允许已有 Figwright plugin。禁止官方 Figma MCP，以及浏览器/API/缓存截图替代当前 Figma 读取。DSH 必须在自己的工具清单发现 Figwright；没有时请求用户打开/配置已安装 plugin，不假设本机工具可跨 Agent 自动使用。

## 连接与批准身份

2026-10-15 实际检查：Figwright 0.6.0，plugin API 1.0.0；`ping`、`list_files`、节点/组件/变量/样式读取和 PNG 导出成功，文件名 `LoomTable Design System`。这是验证记录，不固定未来 sessionId 或批准版本；当时 fileKey 返回 null，不能声称工具已验证 URL 内 key。

1. 发现当前 schema；调用 `ping {}`，确认 `ok` 与 plugin 信息，再 `list_files {}`。
2. 核对目标文件名、页面、session、用户批准的文件链接与正式 Traceability。多文件时 `use_file {"sessionId":"<list_files 返回的实际 ID>"}` 绑定。名称重复不用猜；fileKey 缺失时另核对 Figma 可见文件身份及已知节点，仍不明确则停止。不要把历史 sessionId 写死。
3. 从 Task/Traceability 取得目标 Node / Component / Variant；先读 API，再读具体实例。未批准的变化记录 Design Delta，当前实现不能反向修改 Figma 以通过验收。

## 已核实工具接口

以下是 tool 调用参数，不是命令行。当前平台可能添加 namespace 前缀；执行前重新发现 schema。

| 工具                               | 参数样例                                                                               | 用途 / 本轮验证                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ping` / `list_files`              | `{}`                                                                                   | 连接与当前文件，已调用                                                                                       |
| `use_file`                         | `{"sessionId":"<实际 ID>"}`；释放 `{"release":true}`                                   | schema 已核实；本轮已有目标绑定，未再次改绑定                                                                |
| `get_design_context`               | `{"nodeId":"6:127","detail":"full","depth":2,"dedupeComponents":true}`                 | 结构与完整属性；compact 会省略样式/Token，不能用于量值实现；本轮 compact（6:127）与 full（6:79）调用均已验证 |
| `get_node`                         | `{"nodeId":"6:79"}`                                                                    | 实际节点几何、布局、样式和绑定；已调用                                                                       |
| `get_component_api`                | `{"nodeId":"6:127"}`                                                                   | Variant 与公开属性；已调用，Theme/Size/Icon 与 Label/Instance Swap 返回成功                                  |
| `get_variable_defs` / `get_styles` | `{}`                                                                                   | Variables / Styles；已调用                                                                                   |
| `save_screenshots`                 | `{"nodeIds":["6:79"],"outDir":"<本机绝对 ignored 证据目录>","format":"PNG","scale":1}` | 导出；本轮实际得到 6-79.png，不是宿主截图                                                                    |
| `set_text`                         | `{"nodeId":"<实际 TEXT ID>","characters":"<批准的新文本>"}`                            | 写入 schema 已核实，文档任务未执行写入                                                                       |
| `resize_nodes`                     | `{"nodeIds":["<实际 ID>"],"width":100,"height":32}`                                    | 写入 schema 已核实，数值仅参数示例；未执行，非设计推荐                                                       |

没有已发现接口时不编造 `figwright export` CLI、变量修改命令或 batch 参数。需要其他写入（Auto Layout/Token/Motion 等）先发现其 schema；记录尚未验证的步骤，再在批准任务内验证。

## 设计修改与复核

Design Delta 要包含原批准 Node/Variant、Current/Expected、变更原因、影响消费者与规范、用户裁决和验收。只改授权节点，不为现有代码修改批准标准。写前获取完整节点/变量快照；按当前工具 schema 写入；写后再次 `get_node` / `get_component_api` / Variables 读取并导出，比较实际差值与目标。保持节点身份与变量绑定，若重建导致 ID 改变同步 Traceability，不能只按名字认定同一组件。

尺寸/padding/gap/radius/typography 与状态由完整节点和 DS 对照；截图只是辅助，颜色数值匹配不证明语义 Token 一致。Obsidian 映射走 Loom Token；宿主字体允许的差异需单独说明。

失联时停止设计读写，保留错误和最后已确认步骤；请求重新打开 Figwright，`ping → list_files → 重新确认身份 → 重读目标` 后继续。未知写入结果先读取后判断，不能盲目重放创建操作。Figma 缺证据时标 Not Verified，独立可做的代码/测试工作可以继续。临时导出仅留 ignored 本地资料，正式任务不能依赖这些文件作为唯一输入。

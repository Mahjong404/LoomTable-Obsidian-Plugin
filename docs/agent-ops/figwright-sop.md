# Figwright 设计操作 SOP

仅允许已有 Figwright plugin。禁止官方 Figma MCP，以及浏览器/API/缓存截图替代当前 Figma 读取。DSH 必须在自己的工具清单发现 Figwright；没有时请求用户打开/配置已安装 plugin，不假设本机工具可跨 Agent 自动使用。

## DSH dsh-tui 接入（2026-10-15 实测）

适用基线：DSH 0.2.0-rc.2、dsh-tui 0.15.0、现有 @figwright/mcp 0.6.0。已在 **DSH 自己的 dsh-tui Profile / ToolRuntime** 发现117个 Figwright工具，并调用 ping、list_files、get_node、get_design_context、get_component_api；不是 Codex 代调用。验证没有模型轮次、没有新建 Session，没有写入 Figma。未来版本仍需重新发现工具/schema。

### 架构与前置发现

Codex 的实际注册来自本机 `~/.codex/config.toml` 的 `mcp_servers.figwright`，以 Node 启动已安装 Figwright Server，客户端传输为 **stdio**，不是 Codex 专用 IPC。Server 安装在本机 `C:\software\FigmaTools\figwright\node_modules\@figwright\mcp\`；Figma development plugin 的 manifest 为 `C:\software\FigmaTools\figwright\plugin\manifest.json`，运行中的插件返回版本0.6.0。

MCP Server 内置多客户端 leader/follower：各客户端启动自己的标准 stdio 进程，复用已有 leader 与 Figma 插件 WebSocket。此次现有 leader 监听 `127.0.0.1:3055`，DSH 成为 follower。3055上的 HTTP/MessagePack RPC 是内部 relay，**不是 MCP Streamable HTTP/SSE endpoint**；不要把它填为 DSH 的 HTTP URL，也不直接调用内部 RPC 绕过 Figwright MCP。

DSH 自带的 `@deepseek-ai/dsh-mcp-client` 0.2.0-rc.2 支持 stdio 和 streamable-http；本机已随 DSH 安装，不需要再安装包或代理。`mcp-resources` 只提供资源目录服务，不代表已有 MCP连接。当前 MCP配置不是其他客户端的 `mcpServers` JSON：按本机已安装包的 README.zh.md、Config 类型与实际 Profile启动确认下面的 YAML。

先用已验证的 `dsh --version`、`dsh-tui version`、`dsh --help`、`dsh-tui --help` 确认版本/入口。检查上述 Node、Figwright index.mjs、Figma manifest 和 DSH安装文件实际存在；路径不可直接套到其他机器。不用 `npx @latest` 下载另一版本。

### 只改 Profile 用户层

实际入口为 `~/.dsh/profiles/dsh-tui/cordis.patch.yml`。备份原 patch 与 root `cordis.yml`，核对原文件 SHA-256及副本字节可恢复；不要复制 credentials、修改 package/lock 或删除 Sessions。此轮备份位于同一 Profile 的 `figwright-backups/`，精确备份路径留本地交接。

将这一 **insert 条目**合并到现有 patch 数组；已有配置不得整份覆盖。空 patch 原来为 `[]` 时才可直接替换为：

```yaml
- insert:
    - id: mcp-figwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: figwright
        transport: stdio
        command: 'C:\software\Nodejs\node-v24.18.1-win-x64\node.exe'
        args:
          - 'C:\software\FigmaTools\figwright\node_modules\@figwright\mcp\dist\index.mjs'
        cwd: 'C:\software\FigmaTools\figwright'
        toolCallTimeoutMs: 60000
        failOnStartupError: true
```

这是实际加载成功的配置，不新增认证/env。每个 serverName 只能有一个活跃配置，工具前缀由它生成：`mcp__figwright__<tool>`。DSH当前安装的包解析器可找到随CLI安装的 mcp-client；换机器若报模块缺失，先核对安装/解析，不自动安装软件。

Profile 由 dsh-base、dsh-tui bundle 和用户 patch 合成；`cordis.yml` 是启动器重写的空 root，**不要手改它保存 MCP配置**。本机默认 HMR 会重载 Profile patch；此次既有 TUI 在配置保存后启动了自己的 Figwright follower，不必终止用户会话。未启用 HMR或工具仍未出现时，正常退出并按原方式重开同一 dsh-tui Profile，恢复既有 Session，不删除历史。不把 `dsh --profile dsh-tui --help` 当成纯帮助检查：本版本实测会启动长驻 Profile，启动器 Help 用前述命令。

### 最小连接检查与验收

在 **DSH 自己**的工具目录发现下列名字，再依序调用：

1. `mcp__figwright__ping({})`：确认 `ok:true`、`hop:e2e`、Server/plugin版本。仅看到本地进程启动不算连接Figma。
2. `mcp__figwright__list_files({})`：此次返回唯一 `LoomTable Design System`、页面5:3；用当次 sessionId，不固定旧ID。多文件时按上文 use_file绑定并重新核对。
3. `mcp__figwright__get_node({"nodeId":"6:79"})`：此次得到 Button Compact Light / Icon None，42×28，parent6:127；与已知批准节点交叉核对。
4. `mcp__figwright__get_design_context({"nodeId":"6:79","depth":1,"detail":"full","dedupeComponents":true})`：检查实际布局、Token绑定与文字，不用旧截图代替。
5. `mcp__figwright__get_component_api({"nodeId":"6:127"})`：此次返回 Theme=Light/Dark、Size=Compact/Default、Icon=None/Leading/Trailing 等API；满足非破坏性组件查询验证。

工具名与JSON参数是 tool调用，非shell命令。这里的节点是连接自检样本，不取代具体任务的批准Node/Variant。此次 fileKey仍为null，已以文件名/页面/已知节点核对；不声称验证了URL里的key，身份不明确时停止。

本轮可复现证据来自公开的 DSH `runProfile` 生命周期与 `ToolRuntime.execute`：加载真实用户patch，临时overlay只关闭该诊断调用的TUI前端/OAuth listener，保持其他Profile服务和MCP客户端；退出时调用正常shutdown释放连接。日常接手直接在DSH调用上述工具，不依赖本机ignored诊断脚本。实际模型选择工具、Figma写入与relay故障转移未在此轮测试，不能将只读成功扩大为它们通过。

### 常见失败、恢复与安全边界

- **只有 mcp-resources / 无Figwright工具**：核对是否在正确 dsh-tui Profile、是否有这条 insert、mcp-client是否解析成功；TUI能启动不证明可选插件激活成功。读取错误，不抄其他Agent配置格式。
- **EPERM写cordis.yml**：DSH启动器会标准化root；在真实用户可写的Profile上下文启动。不要改系统ACL、换隐藏Profile或提升长期运行权限掩盖问题。本轮沙箱受限时通过用户授权的配置/诊断操作验证。
- **工具有但插件离线**：在正确Figma文件打开已有Figwright插件，先ping再list_files。无需Figma个人Token或登录凭据，不安装官方Figma MCP。
- **relay/进程失联**：恢复现有Figwright Server/Figma插件后，在DSH重试ping/list_files。DSH客户端源码默认支持带预算重连；耗尽预算后重载该条配置或正常重启Profile。若版本/build skew或端口被无关程序占用，报告真实错误和PID，不能盲杀leader或另开端口假装已接通。此轮未故障注入此路径。
- **恢复原配置**：核对备份hash，保全之后的用户修改，再仅撤销本轮 mcp-figwright条目或恢复对应patch副本；让HMR/正常重启释放该客户端，不动其他MCP客户端、Session或Figma插件。此轮验证了备份字节与恢复副本一致，未对已生效的Profile执行来回回滚。
- **秘密与权限**：本方案不复制Codex私有配置/凭据、不读写Figma用户Token、不修改allowed origin/认证、不暴露监听地址、不添加第三方Bridge。只复用既有Figwright安装与loopback连接。任何后续需要新软件、秘密或权限扩展的方案先交用户批准。

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

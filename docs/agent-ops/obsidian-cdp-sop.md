# 可见 Obsidian / qa-vault SOP

只操作用户已有可见 qa-vault。禁止新 Vault、隐藏 Profile、无头 Obsidian，禁止修改其他 Vault。本文可手动执行；本机 ignored CDP helper 是可选工具，不是干净克隆的必需输入。

## 发现与正常启动

2026-10-15 只读核验：现有 qa-vault 为 `C:\Personal folder\code\LoomTable\LoomTable Obsidian Plugin\docs\local\qa-vault`；CDP 9223 返回该路径，宿主语言 `zh`、Dark、1360×900。可执行文件 `C:\software\Obsidian\Obsidian.exe`。后续仍逐次确认，不能按窗口标题单独认定安全。

```powershell
Get-Process Obsidian -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,MainWindowHandle
Invoke-RestMethod 'http://127.0.0.1:9223/json/list' | Select-Object id,type,title,url
```

端口未开时先检查用户未提交文本；正常菜单退出或可见窗口 Alt+F4，确认主进程退出，再：

```powershell
Start-Process -FilePath 'C:\software\Obsidian\Obsidian.exe' -ArgumentList '--remote-debugging-port=9223'
```

不得 `-WindowStyle Hidden` / `--user-data-dir` / headless；如果应用恢复其他 Vault，停止自动操作，在 GUI 手动选择已有 qa-vault 后再核验。正常关闭失败时报告 PID、窗口和未保存状态，不能自动强杀。Chromium renderer 参数也可能包含 user-data-dir，不可据此误认多份独立隐藏 Obsidian。

## 原生 CDP 连接与 Vault 守卫

以下 Node >=24 脚本可复制到本轮 ignored 证据目录的 `host.mjs`，不需要 Playwright。`node host.mjs` 检查连接与路径；所有变更操作只能追加在守卫通过后。该 RPC/路径模式已用于 C 验收，本轮只读读取亦成功。若 Node/端口缺失，不自动下载工具或启动替代环境。

```js
import { resolve } from 'node:path';
const expectedVault =
  'C:/Personal folder/code/LoomTable/LoomTable Obsidian Plugin/docs/local/qa-vault';
const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const pages = targets.filter((t) => t.type === 'page' && t.title.includes('qa-vault'));
if (pages.length !== 1) throw Error('qa-vault target ambiguous/unavailable');
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  ws.onopen = ok;
  ws.onerror = fail;
});
let sequence = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const reply = JSON.parse(event.data),
    item = pending.get(reply.id);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(reply.id);
  reply.error ? item.reject(Error(reply.error.message)) : item.resolve(reply.result);
};
function send(method, params = {}) {
  return new Promise((resolveReply, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`Timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve: resolveReply, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw Error('Host expression failed; inspect non-secret diagnostics');
  return result.result?.value;
}
try {
  const vault = await evaluate('app.vault.adapter.basePath');
  if (resolve(vault).toLowerCase() !== resolve(expectedVault).toLowerCase())
    throw Error('Refusing different Vault');
  console.log(
    await evaluate(
      '({language:localStorage.getItem("language"),theme:document.body.className,width:innerWidth,height:innerHeight})',
    ),
  );
  // 在这里执行当前已获授权的 QA；不得输出整个 Plugin settings 或 SecretStorage。
} finally {
  ws.close();
}
```

`/json/list` 的 `type:page` 是可用 WebContents endpoint，renderer/GPU PID 不作为目标。若多 Pane 在同一 endpoint，按实际 leaf/container 定位；独立窗口出现多目标时逐目标做只读路径核验，不默认取第一个。

## Bundle 安装与恢复

先在实现 checkout 构建并记录源码 SHA、`main.js`/`styles.css` SHA-256、dirty diff。从已存在 qa-vault 的 `.obsidian/plugins/` 发现实际 Plugin 目录，核对 `manifest.json` 的 id；不要假定其他 Vault 目录相同。先备份目标的 main.js/styles.css/manifest.json 到本轮 ignored 证据目录，不复制含凭据的 data.json。

关闭插件/正常退出宿主以释放代码，再按精确路径仅复制这三个构建文件，保留 data.json 与 SecretStorage。可用 `Copy-Item -LiteralPath <已核实源文件> -Destination <已核实目标文件>`；复制后 `Get-FileHash -Algorithm SHA256 -LiteralPath <目标文件>` 与源逐一比对，再正常启用/重启。未确认 Vault/Plugin 路径时禁止复制。不要将旧 build 的源码 SHA 当作当前安装 Bundle。

## 语言、截图与真实输入

从 Obsidian 设置页与 `localStorage.getItem('language')` 核查实际语言；生产代码通过 Obsidian `getLanguage()` 与 locale=auto 的解析器。检查实际 Plugin settings.locale（只取此键）、`src/main.ts`、`src/i18n/`、Renderer/Toolbar/Filter 文案与刷新。当前 Chinese QA 应由自动策略产生，不能局部替换英文/传入英文 Fixture 或把中文永久硬编码。切换语言需受控并恢复，不改其他 Vault。

守卫后可用以下 CDP 调用，参数从真实 DOM 获取：

- `Runtime.evaluate`：选实际元素 `getBoundingClientRect().toJSON()`，`getComputedStyle(el)` 只取 height/padding/gap/color/border/radius/font/lineHeight/zIndex/overflow；记录 owner、state、scrollLeft/Top、pane rect、theme、font、viewport 和 zoom。不能修改 rect 伪造布局。
- `Page.captureScreenshot {format:'png',fromSurface:true}`：将 data 按 base64 写 PNG。它是宿主 WebContents 截图；要证明可见 GUI 同时保存完整 Obsidian 窗口截图（可见 Windows 截图工具）与窗口身份，不能称孤立 HTML 为宿主。
- `Input.dispatchMouseEvent`：`mouseMoved` → `mousePressed` → `mouseReleased`，button=left、clickCount=1、x/y 来自实际 rect 中心。不同阶段核对焦点，不只 `.click()` 跳过 pointer/focusout 时序。
- `Input.dispatchKeyEvent`：原生 keyDown/keyUp（如 Tab Windows virtual key=9，Escape=27；Enter keyDown text='\r'，13）；键盘原生 button activation 不叠加第二次 click。
- `Input.imeSetComposition`：text / selectionStart / selectionEnd，验证 composing 时 Geometry 更新仍保原始输入 DOM/caret；此为 CDP 模拟。真实中文 IME 使用可见 GUI 当前输入法实际输入，无法完成标 Not Verified，不能用 DOM 事件或模拟宣称真机 IME 通过。

200% Zoom 用实际宿主缩放并核对 zoomFactor；CSS zoom / viewport emulation 不等价。窄 Pane 测真实容器，双 Pane 分 owner；Light/Dark、Reduced Motion、Coarse Pointer 模拟分别记录。无实际 touch/mobile 设备明确 Not Verified。

## 收尾与异常恢复

恢复本轮语言/主题/zoom/Pane；用户待验收的页面状态按用户指示保留。撤销本轮 fault injection、延迟包装、监听器、timer、临时 helper 进程；已接受业务操作不由 UI 清理撤回。确认真实 adapter 方法恢复、无旧 Portal/Tab trap；关闭 CDP WebSocket，不关闭用户需要的窗口。不删除当前 QA Vault/唯一证据/用户数据。

窗口被最小化/遮挡、CDP screenshot 或 rAF 超时：先恢复可见前台并重核 Vault；不切隐藏 Profile 或禁用 background throttling 冒充通过。出现用户并发输入时保护草稿并暂停依赖操作。Unknown Outcome先核对原操作身份/receipt，不改 mutationId 盲重发。无法正常恢复就交代证据、残留状态与需要用户处理的步骤。

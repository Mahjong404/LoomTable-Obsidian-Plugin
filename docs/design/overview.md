# LoomTable Obsidian Plugin 概要设计

## 1. 文档目的

本文定义 LoomTable Obsidian Plugin 的职责、运行边界、主要模块和第一个可用版本的用户流程。实现细节分别记录在 UI、Grid、Field Type 和 Client Interface 文档中。

## 2. 产品职责

Plugin 是 LoomTable 的主要用户界面，负责把服务端的结构化数据呈现为 Obsidian 中可操作的 Workspace View。

Plugin 负责：

- 连接 LoomTable Server。
- 展示 Workspace、Base、Table 和 View 导航。
- 呈现 Grid View 和 Map View。
- 提供 Field Editor、Record 编辑和 View 配置。
- 提供键盘、触控和响应式布局。
- 管理活动 View 的查询窗口、本地缓存和刷新状态。
- 读取 Vault Attachment。
- 通过可选 Adapter 接入 Obsidian 生态。

Plugin 不负责：

- 直接访问 PostgreSQL。
- 作为数据事实来源。
- 把 Record 拆成 Markdown 文件。
- 运行或升级 Docker。
- 在客户端重新实现完整的服务端 Query Engine。

## 3. 运行边界

```text
Obsidian
└── LoomTable Obsidian Plugin
    ├── Obsidian API Adapter
    ├── LoomTable Client
    ├── Local View Cache
    ├── UI and Field Registry
    ├── Grid View
    └── Map View
            │ OpenAPI v1
            ▼
      LoomTable Server
```

Plugin 和 Server 是两个独立仓库、独立发布的产品部件。OpenAPI 是它们之间的唯一接口合同。

## 4. P0 用户流程

```text
打开 Plugin
→ 连接向导
→ Server 健康检查和版本检查
→ 选择 Workspace
→ 打开或创建 Base
→ 打开或创建 Table
→ 创建基础 Field
→ Grid 查询、筛选、排序和编辑
→ Location 选点
→ Map View 查看记录
```

P0 不要求 Attachment、Relation、Formula、Lookup、Rollup 和其他高级 View 完成，但接口和数据模型必须允许后续加入。

## 5. 模块总览

```text
src/
├── main.ts
├── obsidian/
├── connection/
├── navigation/
├── client/
├── cache/
├── domain/
├── ui/
├── fields/
├── views/
│   ├── grid/
│   └── map/
└── settings/
```

模块之间通过小 Interface 通信。UI 不直接创建 HTTP Client；Grid 不直接解析 API 响应；Field Renderer 不直接修改 Record。

## 6. 质量目标

- 20k Records 下 Grid 可浏览和编辑。
- Plugin 不因服务端一次返回全部数据而增长不可控内存。
- Light、Dark、桌面、平板和手机布局可用。
- 主题适配使用 Obsidian CSS Variables，不绑定某个主题。
- 服务不可用时显示缓存并进入只读或离线状态。
- Conflict、AuthError、Readonly 和 ServerIncompatible 有明确 UI 状态。

## 7. 许可证

LoomTable Obsidian Plugin 使用 AGPL-3.0。第三方字体、地图服务、瓦片和依赖需要单独完成许可证审查。


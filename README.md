# LoomTable Obsidian Plugin

LoomTable 的 Obsidian 前端插件。Plugin 使用 TypeScript，通过 LoomTable Server 的 OpenAPI 接口访问数据。

## 当前状态

新建 Connection Profile 默认连接本机 Server 地址 `http://127.0.0.1:31201`；已有 Profile 会保留用户已保存的地址，不会静默迁移。

P0 Plugin 已完成并进入 `v0.1.1` 发布闭环：设置页支持 `/v1/meta` 兼容性检测、只读认证探测和跟随 Obsidian 的语言选择；Workspace → Base → Table → View 导航、只读/编辑 Grid、Mutation Queue、Conflict UI、Map View 与客户端瓦片 Provider 均已合并并通过 CI。当前文档只把已实际验证的平台和图层列为通过项，详见 [v0.1.1 发布说明](./docs/releases/v0.1.1.md)。

Map 默认使用 OpenStreetMap。天地图矢量、影像、地形及注记预设共用一个 Token 设置入口；Plugin 直连必须使用天地图浏览器端应用 Key，标准 WMTS `tk` 请求不需要安全密钥。仓库、测试和日志不包含真实 Key。

## 开发

需要 Node.js 24 和 pnpm 11.16.0：

```text
pnpm install --frozen-lockfile
pnpm check
```

贡献代码前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。分支遵循 GitHub Flow，使用 `feature/`、`fix/`、`docs/` 等用途前缀，不使用个人或自动化工具前缀。

`pnpm dev` 持续生成 Obsidian 加载的 `main.js`；`pnpm build` 生成生产 Bundle。OpenAPI 快照与生成类型均已提交，普通构建不读取同级 Server 工作树，也不访问网络。显式升级契约时运行：

```text
pnpm api:sync <40 位 Server commit SHA>
pnpm api:generate
```

## 文档

- [Plugin 文档索引](./docs/README.md)
- [产品范围](./docs/product/scope.md)
- [Plugin Client Interface](./docs/architecture/client-contract.md)
- [Plugin 源码结构](./docs/architecture/source-layout.md)
- [Plugin 仓库结构与文件职责](./docs/architecture/repository-layout.md)
- [UI Design System](./docs/ui/design-system.md)
- [Grid View 规范](./docs/ui/grid-spec.md)
- [Map View 与瓦片提供方规范](./docs/ui/map-spec.md)

## 运行边界

- 不直接连接 PostgreSQL。
- 不把每条 Record 拆成 Markdown 文件。
- 不负责安装、启动或升级 Docker。
- 使用 Obsidian 主题变量适配 Light、Dark 和移动端环境。
- 生产数据通过 LoomTable Server 获取；本地缓存不是真实数据来源。

许可证：MIT License。


# LoomTable Obsidian Plugin

LoomTable 的 Obsidian 前端插件。Plugin 使用 TypeScript，通过 LoomTable Server 的 OpenAPI 接口访问数据。

## 当前状态

当前仓库处于设计和工程准备阶段，尚未开始 P0 功能实现。

## 文档

- [Plugin 文档索引](./docs/README.md)
- [产品范围](./docs/product/scope.md)
- [Plugin Client Interface](./docs/architecture/client-contract.md)
- [UI Design System](./docs/ui/design-system.md)
- [Grid View 规范](./docs/ui/grid-spec.md)

## 运行边界

- 不直接连接 PostgreSQL。
- 不把每条 Record 拆成 Markdown 文件。
- 不负责安装、启动或升级 Docker。
- 使用 Obsidian 主题变量适配 Light、Dark 和移动端环境。
- 生产数据通过 LoomTable Server 获取；本地缓存不是真实数据来源。

许可证：MIT License。


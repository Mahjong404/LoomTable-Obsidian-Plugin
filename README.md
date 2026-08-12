# LoomTable Obsidian Plugin

LoomTable 的 Obsidian 前端插件。Plugin 使用 TypeScript，通过 LoomTable Server 的 OpenAPI 接口访问数据。

## 当前状态

P0 Plugin 工程基线已经建立：Manifest、严格 TypeScript、esbuild、Vitest、ESLint、Prettier、CI、固定 Server SHA 的 OpenAPI 快照，以及 Connection Profile/凭据/i18n/缓存策略首个前端 seam 均可构建和测试。Grid、Map 与完整 Client 业务能力仍在开发中。

## 开发

需要 Node.js 24 和 pnpm 11.16.0：

```text
pnpm install --frozen-lockfile
pnpm check
```

`pnpm dev` 持续生成 Obsidian 加载的 `main.js`；`pnpm build` 生成生产 Bundle。OpenAPI 快照与生成类型均已提交，普通构建不读取同级 Server 工作树，也不访问网络。显式升级契约时运行：

```text
pnpm api:sync <40 位 Server commit SHA>
pnpm api:generate
```

## 文档

- [Plugin 文档索引](./docs/README.md)
- [产品范围](./docs/product/scope.md)
- [Plugin Client Interface](./docs/architecture/client-contract.md)
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

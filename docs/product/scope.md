# LoomTable 产品范围

## 产品定位

LoomTable 是一个面向 Obsidian 用户的自托管多维数据工作区。它提供表格化记录管理、字段类型、多个 View、地点地图展示和可恢复的数据变更体验。

Obsidian 插件是主要前端，LoomTable Server 是数据事实来源。Personal 模式可以部署在本机 Docker，也可以部署在远程服务器；两者使用同一套协议和数据模型。

## 核心原则

- 服务端是 Record、Field、View 和 Attachment 元数据的事实来源。
- Plugin 不直接连接 PostgreSQL。
- View 只保存查询和展示配置，不复制 Record。
- Record 和 Field 使用稳定 ID，显示名称可以修改。
- 所有危险修改都必须可恢复或提供明确确认。
- 第一阶段不实现实时协作，但从第一天保留 Revision 和 Change Cursor。
- Personal 模式不等于纯本地数据库模式。

## 第一个可用闭环

第一个可用版本应完成一条完整的 Grid + Map 链路：

1. 连接 LoomTable Server。
2. 完成健康检查、Token 验证和 API 版本检查。
3. 创建 Workspace、Base、Table 和 View。
4. 创建和修改基础 Field。
5. 创建、查询和编辑 Record。
6. 对 20k 规模数据执行服务端筛选和排序。
7. 在 Grid View 中进行虚拟化浏览和直接编辑。
8. 使用 Revision 处理并发修改冲突。
9. 使用 Location 保存地点和可选坐标。
10. 在 Map View 中显示带坐标的 Record。

## 字段实现阶段

### P0：基础闭环

- Text
- LongText
- Number
- Checkbox
- Date
- Select
- MultiSelect
- URL
- Location

### P1：内容和关系

- Attachment
- Relation
- Email
- Note Link
- CSV/JSON 导入导出增强

### P2：计算和更多 View

- Formula
- Lookup
- Rollup
- Kanban View
- Gallery View
- Calendar View
- Form View

## 暂不属于第一阶段

- 实时协作和在线用户状态
- Redis、Kafka、RabbitMQ 等 Team 中间件
- 独立纯本地数据库模式
- 插件直接访问数据库
- 必须安装的外部地图或同步插件
- 完整权限、邀请和团队管理
- 复杂 GIS 分析、路线规划和自动化工作流
- 一开始就支持多个数据库引擎

## 部署配置

### Personal

- 单用户。
- 可以有多个客户端。
- LoomTable Server 是唯一数据事实来源。
- 不提供实时协作。
- 本地部署使用 Docker Compose。
- 使用 PostgreSQL 和本地附件存储卷。

### Team（后续）

- 多用户和权限。
- 实时协作。
- Redis 或其他协调组件。
- 后台任务和通知。
- 对象存储和更完整的审计能力。


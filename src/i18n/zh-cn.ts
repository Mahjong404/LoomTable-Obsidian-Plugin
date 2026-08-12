import type { MessageCatalog } from './messages';

export const simplifiedChineseMessages = {
  'command.open': '打开 LoomTable',
  'common.add': '添加',
  'common.delete': '删除',
  'common.save': '保存',
  'connection.default': '默认',
  'connection.empty': '尚未配置连接档案。',
  'connection.name': '名称',
  'connection.newName': 'LoomTable Server',
  'connection.origin': 'Server 地址',
  'connection.profile': '连接档案',
  'connection.rememberToken': '记住 Token',
  'connection.rememberTokenWarning':
    'Token 保存在 Obsidian Secret Storage 中；Vault 或应用配置仍可能被设备备份或同步。',
  'connection.rememberedToken': '已记住的 Token Secret',
  'connection.token': '访问 Token',
  'connection.tokenSession': '除非启用记住 Token，否则仅在本次 Obsidian 会话中保留。',
  'error.invalidOrigin': '请输入不含凭据的 HTTP(S) Server 绝对地址。',
  'language.english': 'English',
  'language.label': '语言',
  'language.zhCN': '简体中文',
  'settings.connections': '连接档案',
  'settings.title': 'LoomTable',
  'view.configure': '请先在 LoomTable 设置中配置连接档案。',
  'view.ready': 'LoomTable 已准备好开始 Plugin 开发。',
  'view.title': 'LoomTable',
} as const satisfies MessageCatalog;

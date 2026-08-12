export const englishMessages = {
  'command.open': 'Open LoomTable',
  'common.add': 'Add',
  'common.delete': 'Delete',
  'common.save': 'Save',
  'connection.default': 'Default',
  'connection.empty': 'No connection profile is configured.',
  'connection.name': 'Name',
  'connection.newName': 'LoomTable Server',
  'connection.origin': 'Server origin',
  'connection.profile': 'Connection profile',
  'connection.rememberToken': 'Remember token',
  'connection.rememberTokenWarning':
    'Stored in Obsidian Secret Storage. Your vault or app configuration may still be included in device backups or sync.',
  'connection.rememberedToken': 'Remembered token secret',
  'connection.token': 'Access token',
  'connection.tokenSession': 'The token is kept only for this Obsidian session unless remembered.',
  'error.invalidOrigin': 'Enter an absolute HTTP(S) server origin without credentials.',
  'language.english': 'English',
  'language.label': 'Language',
  'language.zhCN': '简体中文',
  'settings.connections': 'Connection profiles',
  'settings.title': 'LoomTable',
  'view.configure': 'Configure a connection profile in LoomTable settings to get started.',
  'view.ready': 'LoomTable is ready for Plugin development.',
  'view.title': 'LoomTable',
} as const;

export type MessageKey = keyof typeof englishMessages;
export type MessageCatalog = { readonly [Key in MessageKey]: string };

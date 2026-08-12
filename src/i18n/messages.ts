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
  'connection.test': 'Test connection',
  'connection.testing': 'Testing…',
  'connection.status.authenticationFailed': 'The access token was rejected. Replace it and retry.',
  'connection.status.authenticationRequired':
    'The Server is compatible. Enter a token to authenticate.',
  'connection.status.checking': 'Checking Server compatibility and authentication…',
  'connection.status.connected': 'Connected and authenticated.',
  'connection.status.forbidden':
    'The token is valid but cannot access LoomTable workspaces. Use an authorized token.',
  'connection.status.incompatibleApi': 'This Plugin requires API v1; the Server reported',
  'connection.status.incompatiblePlugin':
    'Update this Plugin. The Server requires at least version',
  'connection.status.migrationRequired':
    'The Server requires a migration before it can be used. Run the Server migration command.',
  'connection.status.notTested': 'Connection has not been tested in this session.',
  'connection.status.requestId': 'Request ID:',
  'connection.status.serverError':
    'The Server returned an unexpected response. Retry and use the Request ID to inspect Server logs.',
  'connection.status.serverVersion': 'Server',
  'connection.status.unreachable':
    'The Server could not be reached. Check the address and Server status, then retry.',
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

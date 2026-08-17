import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';

describe('connection profile actions', () => {
  it.each([
    {
      locale: 'en' as const,
      add: 'Add connection profile',
      addDescription:
        'Add a Server connection profile; this does not create or delete Server data.',
      remove: 'Delete this connection profile',
      removeDescription:
        'Remove this Server connection profile from the Plugin; Server data is not affected.',
    },
    {
      locale: 'zh-CN' as const,
      add: '添加连接档案',
      addDescription: '添加 Server 连接档案；不会创建或删除 Server 数据。',
      remove: '删除此连接档案',
      removeDescription: '从 Plugin 中移除此 Server 连接档案；不会影响 Server 数据。',
    },
  ])(
    '$locale labels profile actions clearly',
    ({ locale, add, addDescription, remove, removeDescription }) => {
      const t = createTranslator(locale);

      expect(t('connection.addProfile')).toBe(add);
      expect(t('connection.addProfileDescription')).toBe(addDescription);
      expect(t('connection.deleteProfile')).toBe(remove);
      expect(t('connection.deleteProfileDescription')).toBe(removeDescription);
    },
  );
});

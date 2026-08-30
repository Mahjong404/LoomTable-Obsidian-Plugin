import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';
import {
  describeTileProviderError,
  formatNamedConfirmation,
} from '../../src/settings/settings-presentation';
import type { TileProviderErrorKind } from '../../src/maps/providers/tile-provider-schema';

const providerErrors: readonly [TileProviderErrorKind, string, string][] = [
  ['configuration-required', 'credential=secret-value', 'map.providerError.configurationRequired'],
  ['invalid-profile', 'profile fields are invalid', 'map.providerError.invalidProfile'],
  [
    'invalid-origin',
    'https://tiles.example/?token=secret-value',
    'map.providerError.invalidOrigin',
  ],
  ['invalid-template', 'https://tiles.example/{unknown}', 'map.providerError.invalidTemplate'],
  ['unsupported-crs', 'EPSG:4326', 'map.providerError.unsupportedCrs'],
  ['tile-error', 'raw network failure', 'map.providerError.tileError'],
];

describe('Settings presentation', () => {
  it.each(['en', 'zh-CN'] as const)(
    'summarizes every tile provider error kind without exposing raw diagnostics (%s)',
    (locale) => {
      const t = createTranslator(locale);

      const summaries = [];
      for (const [kind, message, key] of providerErrors) {
        const summary = describeTileProviderError({ kind }, t);

        expect(summary).toBeTruthy();
        expect(summary).toBe(t(key as Parameters<typeof t>[0]));
        expect(summary).not.toContain(message);
        expect(summary).not.toContain('secret-value');
        summaries.push(summary);
      }
      expect(new Set(summaries).size).toBe(providerErrors.length);
    },
  );

  it.each(['en', 'zh-CN'] as const)(
    'includes the object name, consequence, and translated choices in profile/provider confirmation copy (%s)',
    (locale) => {
      const t = createTranslator(locale);
      const profileMessage = formatNamedConfirmation(
        t('connection.deleteProfileConfirm'),
        'Remote profile',
      );
      const providerMessage = formatNamedConfirmation(t('map.deleteCustomConfirm'), 'Office tiles');

      expect(profileMessage).toContain('Remote profile');
      expect(profileMessage).toContain(t('common.confirm'));
      expect(profileMessage).toContain(t('common.cancel'));
      expect(providerMessage).toContain('Office tiles');
      expect(providerMessage).toContain(t('common.confirm'));
      expect(providerMessage).toContain(t('common.cancel'));
    },
  );
});

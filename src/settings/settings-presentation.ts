import type { Translator } from '../i18n';
import type { TileProviderError } from '../maps/providers/tile-provider-schema';

export function describeTileProviderError(
  error: Pick<TileProviderError, 'kind'>,
  t: Translator,
): string {
  switch (error.kind) {
    case 'configuration-required':
      return t('map.providerError.configurationRequired');
    case 'invalid-profile':
      return t('map.providerError.invalidProfile');
    case 'invalid-origin':
      return t('map.providerError.invalidOrigin');
    case 'invalid-template':
      return t('map.providerError.invalidTemplate');
    case 'unsupported-crs':
      return t('map.providerError.unsupportedCrs');
    case 'tile-error':
      return t('map.providerError.tileError');
    default:
      return t('map.invalidProvider');
  }
}

export function formatNamedConfirmation(template: string, name: string): string {
  return template.replaceAll('{name}', () => name);
}

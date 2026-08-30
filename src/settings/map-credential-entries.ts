import {
  TIANDITU_CREDENTIAL_SLOT_ID,
  type TileProviderRef,
} from '../maps/providers/tile-provider-schema';
import type { MessageKey } from '../i18n/messages';

export interface MapCredentialEntry {
  readonly ref: TileProviderRef;
  readonly slotId: string;
  readonly slotName: MessageKey;
}

export function getBuiltInMapCredentialEntries(): readonly MapCredentialEntry[] {
  return [
    {
      ref: { kind: 'built-in', id: 'tianditu-vector' },
      slotId: TIANDITU_CREDENTIAL_SLOT_ID,
      slotName: 'map.tiandituToken',
    },
  ];
}

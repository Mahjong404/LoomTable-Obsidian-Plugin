import {
  TIANDITU_CREDENTIAL_SLOT_ID,
  type TileProviderRef,
} from '../maps/providers/tile-provider-schema';

export interface MapCredentialEntry {
  readonly ref: TileProviderRef;
  readonly slotId: string;
  readonly slotName: string;
}

export function getBuiltInMapCredentialEntries(): readonly MapCredentialEntry[] {
  return [
    {
      ref: { kind: 'built-in', id: 'tianditu-vector' },
      slotId: TIANDITU_CREDENTIAL_SLOT_ID,
      slotName: '天地图 Token',
    },
  ];
}

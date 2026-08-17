import { describe, expect, it } from 'vitest';

import { getBuiltInMapCredentialEntries } from '../../src/settings/map-credential-entries';
import { credentialBindingKey } from '../../src/maps/providers/tile-provider-schema';

describe('map credential settings entries', () => {
  it('exposes one shared TianDiTu Token entry for all three built-in layers', () => {
    const entries = getBuiltInMapCredentialEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      slotId: 'tianditu-token',
      slotName: '天地图 Token',
    });
    expect(credentialBindingKey(entries[0]!.ref, entries[0]!.slotId)).toBe(
      credentialBindingKey({ kind: 'built-in', id: 'tianditu-terrain' }, 'tianditu-token'),
    );
  });
});


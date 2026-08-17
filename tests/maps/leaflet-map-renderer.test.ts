import { describe, expect, it } from 'vitest';

import { createTileLayerOptions } from '../../src/maps/renderer/leaflet-map-renderer';

describe('Leaflet tile layer adapter options', () => {
  it('omits subdomains for OSM-style layers so Leaflet keeps its defaults', () => {
    const options = createTileLayerOptions(
      {
        id: 'osm-standard',
        role: 'base',
        urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      },
      '© OpenStreetMap contributors',
    );

    expect(options).not.toHaveProperty('subdomains');
  });

  it('preserves explicit provider subdomains', () => {
    const options = createTileLayerOptions(
      {
        id: 'tianditu-vec',
        role: 'base',
        urlTemplate: 'https://{s}.tianditu.gov.cn/vec_w/wmts',
        subdomains: ['t0', 't1'],
      },
      '© 天地图',
    );

    expect(options.subdomains).toEqual(['t0', 't1']);
  });
});

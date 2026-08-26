import { describe, expect, it, vi } from 'vitest';

import { LeafletMapAdapter, createTileLayerOptions } from '../../src/maps/renderer/leaflet-map-renderer';

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

  it('makes point and cluster feature activation keyboard accessible', () => {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.append(container);
    const adapter = new LeafletMapAdapter();
    const map = adapter.createMap(container);
    const onPoint = vi.fn();
    const onCluster = vi.fn();
    const point = adapter.createPointFeature(map, { lat: 1, lng: 2 }, 'Record A', onPoint);
    const cluster = adapter.createClusterFeature(map, { lat: 3, lng: 4 }, '2', onCluster);

    const pointElement = container.querySelector('.loom-map-point');
    const clusterElement = container.querySelector<SVGElement>('.loom-map-cluster');
    expect(pointElement?.getAttribute('aria-label')).toBe('Record A');
    expect(clusterElement?.getAttribute('role')).toBe('button');
    expect(clusterElement?.getAttribute('tabindex')).toBe('0');
    clusterElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(onCluster).toHaveBeenCalledTimes(1);

    cluster.setLabel('3');
    expect(clusterElement?.getAttribute('aria-label')).toBe('3');

    point.remove();
    cluster.remove();
    map.remove();
    container.remove();
  });
});

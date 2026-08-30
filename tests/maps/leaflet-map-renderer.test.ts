import { describe, expect, it, vi } from 'vitest';

import {
  LeafletMapAdapter,
  createTileLayerOptions,
} from '../../src/maps/renderer/leaflet-map-renderer';

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
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 300 },
    });
    document.body.append(container);
    const adapter = new LeafletMapAdapter();
    const map = adapter.createMap(container);
    map.setCamera({ center: { lat: 0, lng: 0 }, zoom: 3 });
    const onPoint = vi.fn();
    const onCluster = vi.fn();
    const point = adapter.createPointFeature(map, { lat: 1, lng: 2 }, 'Record A', onPoint);
    const cluster = adapter.createClusterFeature(map, { lat: 3, lng: 4 }, '2', onCluster);

    const pointElement = container.querySelector('.loom-map-point');
    const clusterElement = container.querySelector<SVGElement>('.loom-map-cluster');
    expect(pointElement?.getAttribute('aria-label')).toBe('Record A');
    expect(pointElement?.getAttribute('role')).toBe('button');
    expect(pointElement?.getAttribute('tabindex')).toBe('0');
    pointElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPoint).toHaveBeenCalledTimes(1);
    expect(clusterElement?.getAttribute('role')).toBe('button');
    expect(clusterElement?.getAttribute('tabindex')).toBe('0');
    clusterElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCluster).toHaveBeenCalledTimes(1);

    cluster.setLabel('3');
    expect(clusterElement?.getAttribute('aria-label')).toBe('3');

    point.remove();
    cluster.remove();
    map.remove();
    container.remove();
  });

  it('exposes namespaced zoom controls for the shared hit-size contract', () => {
    const container = document.createElement('div');
    const shell = document.createElement('div');
    shell.className = 'loom-map-shell';
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 300 },
    });
    shell.append(container);
    document.body.append(shell);
    const map = new LeafletMapAdapter().createMap(container);

    const zoomLinks = shell.querySelectorAll('.leaflet-control-zoom a');
    expect(zoomLinks).toHaveLength(2);
    expect(shell.querySelector('.loom-map-shell .leaflet-control-zoom')).not.toBeNull();

    map.remove();
    shell.remove();
  });
});

MethodException: 
Line |
   2 |  … r.ts' -Raw; $c = $c.Replace([char]13 + [char]10, [char]10).Replace([c …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot convert argument "oldChar", with value: "
", for "Replace" to type "System.Char": "Cannot convert value "
" to type "System.Char". Error: "String must be exactly one character long.""
import * as L from 'leaflet';

import type { MapCamera } from './map-renderer';
import type {
  MapRendererAdapter,
  RendererFeatureHandle,
  RendererLayerHandle,
  RendererMapHandle,
} from './map-renderer';
import type { MapCoordinate, MapViewport } from '../../client/loomtable-client';
import type { ResolvedTileLayer } from '../providers/tile-provider-schema';

export class LeafletMapAdapter implements MapRendererAdapter {
  createMap(container: HTMLElement): RendererMapHandle {
    return new LeafletMapHandle(L.map(container, { zoomControl: true }));
  }

  createTileLayer(
    map: RendererMapHandle,
    layer: ResolvedTileLayer,
    attribution: string,
    onError: (message: string) => void,
  ): RendererLayerHandle {
    const leafletMap = unwrapMap(map);
    const tileLayer = L.tileLayer(layer.urlTemplate, {
      attribution,
      tileSize: layer.tileSize,
      subdomains: layer.subdomains === undefined ? undefined : [...layer.subdomains],
    });
    tileLayer.on('tileerror', () => onError(`Tile layer ${layer.id} failed to load.`));
    return new LeafletLayerHandle(leafletMap, tileLayer);
  }

  createPointFeature(
    map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle {
    const marker = L.marker([position.lat, position.lng], {
      icon: pointIcon(),
      title: label,
    });
    marker.bindTooltip(label);
    marker.on('click', onClick);
    marker.addTo(unwrapMap(map));
    return new LeafletFeatureHandle(marker, label);
  }

  createClusterFeature(
    map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle {
    const marker = L.circleMarker([position.lat, position.lng], {
      radius: 15,
      className: 'loom-map-cluster',
    });
    marker.bindTooltip(label);
    marker.on('click', onClick);
    marker.addTo(unwrapMap(map));
    return new LeafletFeatureHandle(marker, label);
  }
}

class LeafletMapHandle implements RendererMapHandle {
  constructor(readonly raw: L.Map) {}

  onCameraChanged(listener: () => void): void {
    this.raw.on('moveend zoomend', listener);
  }

  offCameraChanged(listener: () => void): void {
    this.raw.off('moveend zoomend', listener);
  }

  getCamera(): MapCamera {
    const center = this.raw.getCenter();
    return { center: { lat: center.lat, lng: center.lng }, zoom: this.raw.getZoom() };
  }

  setCamera(camera: MapCamera): void {
    this.raw.setView([camera.center.lat, camera.center.lng], camera.zoom, { animate: false });
  }

  fitBounds(bounds: MapViewport): void {
    const first = bounds.boxes[0];
    const second = bounds.boxes[1];
    if (first !== undefined && second !== undefined) {
      const crossing = crossingBounds(first, second);
      if (crossing !== null) {
        this.raw.fitBounds(
          L.latLngBounds([
            [crossing.south, crossing.west],
            [crossing.north, crossing.east],
          ]),
          { padding: [24, 24] },
        );
        return;
      }
    }
    const points: L.LatLngExpression[] = [];
    for (const box of bounds.boxes) {
      points.push([box.south, box.west], [box.north, box.east]);
    }
    if (points.length > 0) this.raw.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }

  getViewport(): MapViewport {
    const bounds = this.raw.getBounds();
    const west = Math.max(-180, bounds.getWest());
    const east = Math.min(180, bounds.getEast());
    const south = Math.max(-85.0511287798066, bounds.getSouth());
    const north = Math.min(85.0511287798066, bounds.getNorth());
    if (west <= east) return { boxes: [{ west, south, east, north }] };
    return {
      boxes: [
        { west, south, east: 180, north },
        { west: -180, south, east, north },
      ],
    };
  }

  getPixelSize(): { readonly width: number; readonly height: number } {
    const size = this.raw.getSize();
    return { width: size.x, height: size.y };
  }

  invalidateSize(): void {
    this.raw.invalidateSize({ pan: false });
  }

  remove(): void {
    this.raw.remove();
  }
}

function crossingBounds(
  first: MapViewport['boxes'][number],
  second: MapViewport['boxes'][number],
): {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
} | null {
  if (first.east >= 180 && second.west <= -180) {
    return {
      west: first.west,
      east: second.east + 360,
      south: Math.min(first.south, second.south),
      north: Math.max(first.north, second.north),
    };
  }
  if (second.east >= 180 && first.west <= -180) {
    return {
      west: second.west,
      east: first.east + 360,
      south: Math.min(first.south, second.south),
      north: Math.max(first.north, second.north),
    };
  }
  return null;
}

class LeafletLayerHandle implements RendererLayerHandle {
  constructor(
    private readonly map: L.Map,
    private readonly layer: L.TileLayer,
  ) {}

  add(): void {
    this.layer.addTo(this.map);
  }

  remove(): void {
    this.map.removeLayer(this.layer);
  }
}

class LeafletFeatureHandle implements RendererFeatureHandle {
  #label: string;

  constructor(
    private readonly layer: L.Layer & L.Evented,
    label: string,
  ) {
    this.#label = label;
  }

  setPosition(position: MapCoordinate): void {
    if (this.layer instanceof L.Marker || this.layer instanceof L.CircleMarker) {
      this.layer.setLatLng([position.lat, position.lng]);
    }
  }

  setLabel(label: string): void {
    if (label === this.#label) return;
    this.#label = label;
    if ('setTooltipContent' in this.layer && typeof this.layer.setTooltipContent === 'function') {
      this.layer.setTooltipContent(label);
    }
  }

  remove(): void {
    this.layer.remove();
  }
}

function unwrapMap(map: RendererMapHandle): L.Map {
  if (!(map instanceof LeafletMapHandle)) {
    throw new Error('The Leaflet adapter requires its own map handle.');
  }
  return map.raw;
}

function pointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'loom-map-point',
    html: '<span aria-hidden="true"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}


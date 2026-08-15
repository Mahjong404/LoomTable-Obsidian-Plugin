import type { TileProviderDefinition } from './tile-provider-schema';

const TIANDITU_SUBDOMAINS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] as const;
const TIANDITU_CREDENTIAL_SLOT = {
  id: 'tianditu-token',
  displayName: '天地图 Token',
  required: true,
} as const;

const osmAttribution = [
  {
    label: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/',
  },
] as const;

function tiandituDefinition(
  id: 'tianditu-vector' | 'tianditu-imagery' | 'tianditu-terrain',
  displayName: string,
  layer: 'vec' | 'img' | 'ter',
  labelLayer: 'cva' | 'cia' | 'cta',
): TileProviderDefinition {
  const urlTemplate = (name: string): string =>
    `https://{s}.tianditu.gov.cn/${name}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${name}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={credential:tianditu-token}`;
  return {
    schemaVersion: 1,
    id,
    displayName,
    protocol: 'wmts-template',
    crs: 'EPSG:3857',
    layers: [
      {
        id: layer,
        role: 'base',
        urlTemplate: urlTemplate(layer),
        subdomains: TIANDITU_SUBDOMAINS,
        tileSize: 256,
      },
      {
        id: labelLayer,
        role: 'labels',
        urlTemplate: urlTemplate(labelLayer),
        subdomains: TIANDITU_SUBDOMAINS,
        tileSize: 256,
      },
    ],
    minZoom: 0,
    maxZoom: 18,
    attribution: [{ label: '© 天地图', url: 'https://www.tianditu.gov.cn/' }],
    usagePolicyUrl: 'https://lbs.tianditu.gov.cn/server/MapService.html',
    allowedOrigins: TIANDITU_SUBDOMAINS.map((subdomain) => `https://${subdomain}.tianditu.gov.cn`),
    credentialSlots: [TIANDITU_CREDENTIAL_SLOT],
    offlinePolicy: 'provider-defined',
  };
}

export const BUILT_IN_TILE_PROVIDERS: readonly TileProviderDefinition[] = [
  {
    schemaVersion: 1,
    id: 'osm-standard',
    displayName: 'OpenStreetMap Standard',
    protocol: 'xyz',
    crs: 'EPSG:3857',
    layers: [
      {
        id: 'osm-standard',
        role: 'base',
        urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        tileSize: 256,
      },
    ],
    minZoom: 0,
    maxZoom: 19,
    attribution: osmAttribution,
    usagePolicyUrl: 'https://operations.osmfoundation.org/policies/tiles/',
    allowedOrigins: ['https://tile.openstreetmap.org'],
    offlinePolicy: 'forbidden',
  },
  tiandituDefinition('tianditu-vector', '天地图矢量', 'vec', 'cva'),
  tiandituDefinition('tianditu-imagery', '天地图影像', 'img', 'cia'),
  tiandituDefinition('tianditu-terrain', '天地图地形', 'ter', 'cta'),
];


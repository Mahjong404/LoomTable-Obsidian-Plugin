import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MapCamera,
  MapRenderer,
  MapRendererEventListener,
} from '../../src/maps/renderer/map-renderer';
import type {
  ResolvedTilePlan,
  TileProviderResolution,
} from '../../src/maps/providers/tile-provider-schema';
import type { MapFeature, MapViewport } from '../../src/client/loomtable-client';
import {
  LocationPreviewController,
  type LocationPreviewRequest,
} from '../../src/ui/location-preview';
import { createTranslator } from '../../src/i18n';

class RecordingRenderer implements MapRenderer {
  mounts = 0;
  destroys = 0;
  invalidations = 0;
  plans: ResolvedTilePlan[] = [];
  cameras: MapCamera[] = [];
  featureSets: MapFeature[][] = [];
  listener: MapRendererEventListener | null = null;
  container: HTMLElement | null = null;

  mount(container: HTMLElement, listener: MapRendererEventListener): void {
    this.mounts += 1;
    this.container = container;
    this.listener = listener;
  }

  setTilePlan(plan: ResolvedTilePlan): void {
    this.plans.push(plan);
  }

  setCamera(camera: MapCamera): void {
    this.cameras.push(camera);
  }

  fitBounds(_bounds: MapViewport): void {}

  setFeatures(features: readonly MapFeature[]): void {
    this.featureSets.push([...features]);
  }

  invalidateSize(): void {
    this.invalidations += 1;
  }

  destroy(): void {
    this.destroys += 1;
  }
}

const plan: ResolvedTilePlan = {
  providerId: 'osm',
  displayName: 'OpenStreetMap',
  protocol: 'xyz',
  crs: 'EPSG:3857',
  layers: [
    {
      id: 'base',
      role: 'base',
      urlTemplate: 'https://tile.example/{z}/{x}/{y}.png',
    },
  ],
  minZoom: 0,
  maxZoom: 19,
  attribution: [{ label: 'OSM contributors' }],
};

function createHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

function createAnchor(host: HTMLElement): HTMLElement {
  const anchor = document.createElement('button');
  host.append(anchor);
  return anchor;
}

function createRequest(
  anchor: HTMLElement,
  mode: 'hover' | 'button' = 'button',
): LocationPreviewRequest {
  return {
    recordId: 'record_01',
    fieldId: 'field_location',
    coordinates: { lat: 12.5, lng: 34.25 },
    label: 'HQ',
    anchor,
    mode,
  };
}

function popover(): HTMLElement | null {
  return document.body.querySelector('.loom-location-preview-popover');
}

function createController(
  overrides: Partial<ConstructorParameters<typeof LocationPreviewController>[0]> = {},
): {
  controller: LocationPreviewController;
  host: HTMLElement;
  renderer: RecordingRenderer;
  resolveProvider: ReturnType<typeof vi.fn>;
} {
  const host = createHost();
  const renderer = new RecordingRenderer();
  const resolveProvider = vi.fn((): TileProviderResolution => ({ ok: true, plan }));
  const controller = new LocationPreviewController({
    translate: createTranslator('en'),
    host: () => host,
    resolveProvider,
    createRenderer: () => renderer,
    ...overrides,
  });
  return { controller, host, renderer, resolveProvider };
}

describe('LocationPreviewController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('opens a real map preview on button activation with clamped zoom and a single point', async () => {
    const { controller, renderer } = createController();
    const anchor = createAnchor(document.body);
    controller.preview(createRequest(anchor));
    await vi.advanceTimersByTimeAsync(0);

    const root = popover();
    expect(root).not.toBeNull();
    expect(renderer.mounts).toBe(1);
    expect(renderer.plans).toHaveLength(1);
    expect(renderer.cameras).toEqual([{ center: { lat: 12.5, lng: 34.25 }, zoom: 14 }]);
    expect(renderer.featureSets).toHaveLength(1);
    expect(renderer.featureSets[0]?.[0]).toMatchObject({
      kind: 'point',
      recordId: 'record_01',
      position: { lat: 12.5, lng: 34.25 },
    });
    expect(renderer.invalidations).toBeGreaterThan(0);
    expect(root?.querySelector('.loom-location-preview-summary')?.textContent).toContain(
      '12.5, 34.25',
    );
    expect(root?.querySelector('.loom-location-preview-summary')?.textContent).toContain(
      'OSM contributors',
    );
  });

  it('clamps the initial zoom to the provider maximum', async () => {
    const lowZoomPlan = { ...plan, maxZoom: 5 };
    const { controller, renderer } = createController({
      resolveProvider: () => ({ ok: true, plan: lowZoomPlan }),
    });
    controller.preview(createRequest(createAnchor(document.body)));
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.cameras[0]?.zoom).toBe(5);
  });

  it('opens after 180ms of ctrl-hover and not before', async () => {
    const { controller, renderer } = createController();
    const anchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(anchor, 'hover'));
    await vi.advanceTimersByTimeAsync(179);
    expect(popover()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(popover()).not.toBeNull();
    expect(renderer.mounts).toBe(1);
  });

  it('cancels a scheduled hover preview when the pointer leaves the trigger', async () => {
    const { controller, renderer } = createController();
    const anchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(anchor, 'hover'));
    controller.endHover();
    await vi.advanceTimersByTimeAsync(200);
    expect(popover()).toBeNull();
    expect(renderer.mounts).toBe(0);
  });

  it('keeps a hover preview while the pointer moves from the trigger into the preview', async () => {
    const { controller } = createController();
    const anchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(anchor, 'hover'));
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(0);
    const root = popover();
    expect(root).not.toBeNull();

    controller.endHover();
    root?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(popover()).not.toBeNull();
  });

  it('closes a hover preview after the leave grace period', async () => {
    const { controller, renderer } = createController();
    const anchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(anchor, 'hover'));
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(0);
    controller.endHover();
    await vi.advanceTimersByTimeAsync(149);
    expect(popover()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(popover()).toBeNull();
    expect(renderer.destroys).toBe(1);
  });

  it('closes a hover preview when the modifier key is released', async () => {
    const { controller, renderer } = createController();
    const anchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(anchor, 'hover'));
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(0);
    expect(popover()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(popover()).toBeNull();
    expect(renderer.destroys).toBe(1);
  });

  it('does not steal focus for hover previews', async () => {
    const { controller } = createController();
    const anchor = createAnchor(document.body);
    anchor.focus();
    controller.scheduleHover(createRequest(anchor, 'hover'));
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(anchor);
  });

  it('moves focus into a button-opened preview and restores it to the trigger on Escape', async () => {
    const { controller } = createController();
    const anchor = createAnchor(document.body);
    anchor.focus();
    controller.preview(createRequest(anchor));
    await vi.advanceTimersByTimeAsync(0);
    const root = popover();
    expect(root).not.toBeNull();
    expect(root?.contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes a button preview on outside pointerdown without moving focus steal on hover', async () => {
    const { controller } = createController();
    const anchor = createAnchor(document.body);
    controller.preview(createRequest(anchor));
    await vi.advanceTimersByTimeAsync(0);
    expect(popover()).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(popover()).toBeNull();
  });

  it('ignores a late provider resolution after close', async () => {
    let resolveResult: ((resolution: TileProviderResolution) => void) | undefined;
    const resolveProvider = vi.fn(
      () =>
        new Promise<TileProviderResolution>((resolve) => {
          resolveResult = resolve;
        }),
    );
    const { controller, renderer } = createController({ resolveProvider });
    const anchor = createAnchor(document.body);
    controller.preview(createRequest(anchor));
    controller.close();
    resolveResult?.({ ok: true, plan });
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.mounts).toBe(0);
    expect(popover()).toBeNull();
  });

  it('keeps only the newest preview when requests switch rapidly', async () => {
    let resolvers: Array<(resolution: TileProviderResolution) => void> = [];
    const resolveProvider = vi.fn(
      () =>
        new Promise<TileProviderResolution>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { controller, renderer } = createController({ resolveProvider });
    const firstAnchor = createAnchor(document.body);
    const secondAnchor = createAnchor(document.body);
    controller.preview(createRequest(firstAnchor));
    controller.preview({ ...createRequest(secondAnchor), recordId: 'record_02' });
    resolvers[0]?.({ ok: true, plan });
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.mounts).toBe(0);
    resolvers[1]?.({ ok: true, plan });
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.mounts).toBe(1);
    expect(document.body.querySelectorAll('.loom-location-preview-popover')).toHaveLength(1);
  });

  it('destroys the renderer exactly once across close and dispose', async () => {
    const { controller, renderer } = createController();
    controller.preview(createRequest(createAnchor(document.body)));
    await vi.advanceTimersByTimeAsync(0);
    controller.close();
    controller.dispose();
    controller.close();
    expect(renderer.destroys).toBe(1);
  });

  it('switches an open hover preview to a different Record/Field trigger', async () => {
    const { controller, renderer } = createController();
    const firstAnchor = createAnchor(document.body);
    const secondAnchor = createAnchor(document.body);
    controller.scheduleHover(createRequest(firstAnchor, 'hover'));
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(0);
    controller.scheduleHover({
      ...createRequest(secondAnchor, 'hover'),
      recordId: 'record_02',
      fieldId: 'field_other',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.mounts).toBe(2);
    expect(renderer.destroys).toBe(1);
    expect(renderer.featureSets.at(-1)?.[0]).toMatchObject({ recordId: 'record_02' });
  });

  it('ignores every preview request after dispose', async () => {
    const { controller, renderer } = createController();
    controller.dispose();
    controller.preview(createRequest(createAnchor(document.body)));
    controller.scheduleHover(createRequest(createAnchor(document.body), 'hover'));
    await vi.advanceTimersByTimeAsync(300);
    expect(popover()).toBeNull();
    expect(renderer.mounts).toBe(0);
  });

  it('shows an offline state without resolving a provider or mounting a renderer', async () => {
    const { controller, renderer, resolveProvider } = createController({
      isOffline: () => true,
    });
    controller.preview(createRequest(createAnchor(document.body)));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(renderer.mounts).toBe(0);
    const root = popover();
    expect(root).not.toBeNull();
    expect(root?.querySelector('.loom-location-preview-status')?.textContent).toContain('Offline');
    expect(root?.querySelector('.loom-location-preview-summary')?.textContent).toContain(
      '12.5, 34.25',
    );
  });

  it('shows a configuration-required state with a settings entry and no tile requests', async () => {
    const onOpenSettings = vi.fn();
    const { controller, renderer } = createController({
      resolveProvider: () => ({
        ok: false,
        error: {
          kind: 'configuration-required',
          providerId: 'custom:x',
          message: 'A tile provider is not configured.',
        },
      }),
      onOpenSettings,
    });
    controller.preview(createRequest(createAnchor(document.body)));
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.mounts).toBe(0);
    const status = popover()?.querySelector('.loom-location-preview-status');
    expect(status?.textContent).toContain('not configured');
    const settingsButton = popover()?.querySelector<HTMLButtonElement>(
      '.loom-location-preview-settings',
    );
    settingsButton?.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps summary content when tiles fail and reports the error', async () => {
    const { controller, renderer } = createController();
    controller.preview(createRequest(createAnchor(document.body)));
    await vi.advanceTimersByTimeAsync(0);
    renderer.listener?.tileError?.({ kind: 'tile', message: 'boom', providerId: 'osm' });
    const root = popover();
    expect(root?.querySelector('.loom-location-preview-status')?.textContent).toContain('Tile');
    expect(root?.querySelector('.loom-location-preview-summary')?.textContent).toContain(
      '12.5, 34.25',
    );
  });

  it('invokes onOpenInMap with the request and closes the preview', async () => {
    const onOpenInMap = vi.fn();
    const { controller } = createController({ onOpenInMap });
    const request = createRequest(createAnchor(document.body));
    controller.preview(request);
    await vi.advanceTimersByTimeAsync(0);
    popover()?.querySelector<HTMLButtonElement>('.loom-location-preview-open-map')?.click();
    expect(onOpenInMap).toHaveBeenCalledWith(request);
    expect(popover()).toBeNull();
  });
});

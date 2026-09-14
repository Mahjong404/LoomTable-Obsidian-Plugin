import type { MapCoordinate } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { ensureButtonLabels, labelContainer } from './a11y';
import type { MapRenderer, MapRendererEventListener } from '../maps/renderer/map-renderer';
import type { TileProviderResolution } from '../maps/providers/tile-provider-schema';

const HOVER_DELAY_MS = 180;
const LEAVE_GRACE_MS = 150;
const PREVIEW_ZOOM = 14;

export interface LocationPreviewRequest {
  readonly recordId: string;
  readonly fieldId: string;
  readonly coordinates: MapCoordinate;
  readonly label: string;
  readonly anchor: HTMLElement;
  readonly mode: 'hover' | 'button';
}

export interface LocationPreviewHandle {
  preview(request: LocationPreviewRequest): void;
  scheduleHover(request: LocationPreviewRequest): void;
  endHover(): void;
  close(): void;
}

export interface LocationPreviewDeps {
  readonly translate: Translator;
  readonly host: () => HTMLElement;
  readonly resolveProvider: (
    request: LocationPreviewRequest,
  ) => TileProviderResolution | Promise<TileProviderResolution>;
  readonly createRenderer: () => MapRenderer;
  readonly isOffline?: () => boolean;
  readonly onOpenInMap?: (request: LocationPreviewRequest) => void | Promise<void>;
  readonly onOpenSettings?: () => void | Promise<void>;
}

export class LocationPreviewController implements LocationPreviewHandle {
  readonly #deps: LocationPreviewDeps;
  #generation = 0;
  #disposed = false;
  #scheduleTimer: number | null = null;
  #graceTimer: number | null = null;
  #request: LocationPreviewRequest | null = null;
  #popover: HTMLElement | null = null;
  #renderer: MapRenderer | null = null;
  #removeListeners: (() => void) | null = null;

  constructor(deps: LocationPreviewDeps) {
    this.#deps = deps;
  }

  preview(request: LocationPreviewRequest): void {
    this.#open({ ...request, mode: 'button' });
  }

  scheduleHover(request: LocationPreviewRequest): void {
    if (this.#disposed) return;
    if (this.#request !== null && this.#popover !== null) {
      if (this.#request.mode !== 'hover') return;
      this.#cancelGrace();
      if (
        this.#request.recordId === request.recordId &&
        this.#request.fieldId === request.fieldId
      ) {
        return;
      }
      this.#open({ ...request, mode: 'hover' });
      return;
    }
    if (this.#scheduleTimer !== null) return;
    this.#attachDocListeners();
    const scheduled: LocationPreviewRequest = { ...request, mode: 'hover' };
    this.#scheduleTimer = window.setTimeout(() => {
      this.#scheduleTimer = null;
      this.#open(scheduled);
    }, HOVER_DELAY_MS);
  }

  endHover(): void {
    if (this.#scheduleTimer !== null) {
      window.clearTimeout(this.#scheduleTimer);
      this.#scheduleTimer = null;
      this.#removeDocListeners();
      return;
    }
    if (this.#request?.mode !== 'hover' || this.#popover === null) return;
    this.#cancelGrace();
    this.#graceTimer = window.setTimeout(() => {
      this.#graceTimer = null;
      this.close();
    }, LEAVE_GRACE_MS);
  }

  close(): void {
    this.#generation += 1;
    if (this.#scheduleTimer !== null) {
      window.clearTimeout(this.#scheduleTimer);
      this.#scheduleTimer = null;
    }
    this.#cancelGrace();
    this.#removeDocListeners();
    const renderer = this.#renderer;
    this.#renderer = null;
    this.#popover?.remove();
    this.#popover = null;
    const request = this.#request;
    this.#request = null;
    renderer?.destroy();
    if (request?.mode === 'button' && request.anchor.isConnected) {
      request.anchor.focus();
    }
  }

  dispose(): void {
    this.close();
    this.#disposed = true;
  }

  #open(request: LocationPreviewRequest): void {
    if (this.#disposed) return;
    this.close();
    if (!request.anchor.isConnected) return;
    this.#request = request;
    const generation = this.#generation;
    const translate = this.#deps.translate;

    const popover = document.createElement('div');
    popover.className = 'loom-map-shell loom-location-preview-popover';
    popover.setAttribute('role', 'dialog');
    labelContainer(popover, translate('record.location.preview'));
    popover.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'loom-location-preview-header';
    const title = document.createElement('span');
    title.className = 'loom-location-preview-title';
    title.textContent = translate('record.location.preview');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'loom-button loom-location-preview-close';
    closeButton.textContent = translate('common.close');
    closeButton.addEventListener('click', () => this.close());
    header.append(title, closeButton);

    const mapContainer = document.createElement('div');
    mapContainer.className = 'loom-location-preview-map';

    const summary = document.createElement('p');
    summary.className = 'loom-location-preview-summary';

    const status = document.createElement('p');
    status.className = 'loom-location-preview-status';
    status.setAttribute('role', 'status');
    status.textContent = translate('map.preview.loading');

    const actions = document.createElement('div');
    actions.className = 'loom-location-preview-actions';
    if (this.#deps.onOpenInMap !== undefined) {
      const openMap = document.createElement('button');
      openMap.type = 'button';
      openMap.className = 'loom-button loom-location-preview-open-map';
      openMap.textContent = translate('record.location.openMap');
      openMap.addEventListener('click', () => {
        const current = this.#request;
        this.close();
        if (current !== null) void this.#deps.onOpenInMap?.(current);
      });
      actions.append(openMap);
    }

    popover.append(header, mapContainer, summary, status, actions);
    ensureButtonLabels(popover);
    this.#position(popover, request.anchor);
    this.#deps.host().append(popover);
    this.#popover = popover;
    this.#attachDocListeners();
    popover.addEventListener('pointerenter', () => this.#cancelGrace());
    popover.addEventListener('pointerleave', () => {
      if (this.#request?.mode === 'hover') this.endHover();
    });
    if (request.mode === 'button') popover.focus();

    this.#renderSummary(summary, request, null);
    void this.#mountPreview(request, generation, mapContainer, summary, status);
  }

  async #mountPreview(
    request: LocationPreviewRequest,
    generation: number,
    mapContainer: HTMLElement,
    summary: HTMLElement,
    status: HTMLElement,
  ): Promise<void> {
    const translate = this.#deps.translate;
    if (this.#deps.isOffline?.() === true) {
      status.textContent = translate('map.preview.offline');
      return;
    }
    let resolution: TileProviderResolution;
    try {
      resolution = await this.#deps.resolveProvider(request);
    } catch {
      resolution = {
        ok: false,
        error: {
          kind: 'configuration-required',
          providerId: '',
          message: 'Tile provider resolution failed.',
        },
      };
    }
    if (generation !== this.#generation || this.#request !== request) return;
    if (!resolution.ok) {
      mapContainer.remove();
      status.textContent = resolution.error.message;
      if (this.#deps.onOpenSettings !== undefined) {
        const settings = document.createElement('button');
        settings.type = 'button';
        settings.className = 'loom-button loom-location-preview-settings';
        settings.textContent = translate('common.openSettings');
        settings.addEventListener('click', () => void this.#deps.onOpenSettings?.());
        status.after(settings);
      }
      return;
    }
    const plan = resolution.plan;
    this.#renderSummary(summary, request, plan.attribution);
    const renderer = this.#deps.createRenderer();
    if (generation !== this.#generation || this.#request !== request) return;
    this.#renderer = renderer;
    const listener: MapRendererEventListener = {
      tileError: () => {
        if (generation !== this.#generation) return;
        status.textContent = translate('map.tiles.error');
      },
      tileReady: () => {
        if (generation !== this.#generation) return;
        status.textContent = translate('map.tiles.ready');
      },
    };
    renderer.mount(mapContainer, listener);
    renderer.setTilePlan(plan);
    renderer.setCamera({
      center: request.coordinates,
      zoom: Math.min(PREVIEW_ZOOM, plan.maxZoom),
    });
    renderer.setFeatures([
      {
        kind: 'point',
        recordId: request.recordId,
        position: request.coordinates,
        primaryFieldText: request.label,
      },
    ]);
    window.setTimeout(() => {
      if (generation === this.#generation && this.#renderer === renderer) {
        renderer.invalidateSize();
      }
    }, 0);
  }

  #renderSummary(
    summary: HTMLElement,
    request: LocationPreviewRequest,
    attribution: readonly { readonly label: string; readonly url?: string }[] | null,
  ): void {
    const parts = [request.label, `${request.coordinates.lat}, ${request.coordinates.lng}`].filter(
      (part) => part.length > 0,
    );
    const text = parts.join(' · ');
    summary.textContent =
      attribution === null || attribution.length === 0
        ? text
        : text + ' · ' + attribution.map((entry) => entry.label).join(', ');
  }

  #position(popover: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;
  }

  #attachDocListeners(): void {
    this.#removeDocListeners();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    };
    const keyup = (event: KeyboardEvent): void => {
      if (this.#request?.mode === 'hover' && (event.key === 'Control' || event.key === 'Meta')) {
        this.close();
      } else if (
        this.#scheduleTimer !== null &&
        (event.key === 'Control' || event.key === 'Meta')
      ) {
        this.endHover();
      }
    };
    const pointerdown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.#popover?.contains(target) === true) return;
      if (this.#request?.anchor.contains(target) === true) return;
      this.close();
    };
    const blur = (): void => this.close();
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    document.addEventListener('pointerdown', pointerdown, true);
    window.addEventListener('blur', blur);
    this.#removeListeners = () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      document.removeEventListener('pointerdown', pointerdown, true);
      window.removeEventListener('blur', blur);
    };
  }

  #removeDocListeners(): void {
    this.#removeListeners?.();
    this.#removeListeners = null;
  }

  #cancelGrace(): void {
    if (this.#graceTimer !== null) {
      window.clearTimeout(this.#graceTimer);
      this.#graceTimer = null;
    }
  }
}

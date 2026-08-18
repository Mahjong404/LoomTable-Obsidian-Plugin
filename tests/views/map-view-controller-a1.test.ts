import { describe, expect, it, vi } from "vitest";

import {
  LoomTableClientError,
  type Field,
  type LoomTableClient,
  type MapQueryResult,
  type View,
} from "../../src/client/loomtable-client";
import { TileProviderRegistry } from "../../src/maps/providers/tile-provider-registry";
import type { TileCredentialReader } from "../../src/maps/providers/tile-provider-schema";
import type {
  MapRenderer,
  MapRendererEventListener,
} from "../../src/maps/renderer/map-renderer";
import { MapViewController } from "../../src/views/map/map-view-controller";

describe("MapViewController A1 lifecycle contract", () => {
  it("rejects a deleted or foreign-table Location Field without querying Map data", async () => {
    const summarizeMap = vi.fn();
    const controller = createController(
      createClient({ summarizeMap }),
      createMapView(),
      [{ ...createField("field_location"), tableId: "other_table" }],
    );

    await controller.load();

    expect(controller.state.dataStatus).toBe("configuration-required");
    expect(controller.state.error).toMatchObject({
      code: "VIEW_CONFIGURATION_REQUIRED",
      apiDetails: { viewId: "view_map", brokenFieldIds: ["field_location"] },
    });
    expect(summarizeMap).not.toHaveBeenCalled();
  });

  it("stores the Map change cursor and falls back to Record ID for empty Point text", async () => {
    const queryMap = vi.fn().mockResolvedValue({
      features: [
        {
          kind: "point",
          recordId: "record_untitled",
          position: { lat: 1, lng: 2 },
          primaryFieldText: "   ",
        },
      ],
      viewportRenderableRecordCount: 1,
      viewRevision: 1,
      changeCursor: "change_query_01",
    } satisfies MapQueryResult);
    const renderer = new FakeRenderer();
    const controller = createController(
      createClient({ queryMap }),
      createMapView(),
      [createField("field_location")],
      renderer,
    );

    await controller.refreshCurrentViewport();

    expect(controller.state.changeCursor).toBe("change_query_01");
    expect(controller.state.features[0]).toMatchObject({
      recordId: "record_untitled",
      primaryFieldText: "record_untitled",
    });
    expect(renderer.features[0]).toMatchObject({
      primaryFieldText: "record_untitled",
    });
  });

  it("refreshes the viewport when a Cluster page expires with INVALID_CURSOR", async () => {
    const queryMap = vi
      .fn()
      .mockResolvedValueOnce(clusterResult("change_query_01"))
      .mockResolvedValueOnce(clusterResult("change_query_02"));
    const queryMapClusterRecords = vi.fn().mockRejectedValue(
      new LoomTableClientError("cursor-expired", {
        message: "Refresh the Map query.",
        code: "INVALID_CURSOR",
        httpStatus: 400,
      }),
    );
    const controller = createController(
      createClient({ queryMap, queryMapClusterRecords }),
      createMapView(),
      [createField("field_location")],
    );

    await controller.refreshCurrentViewport();
    await controller.openCluster("cluster_01");

    expect(queryMapClusterRecords).toHaveBeenCalledWith("view_map", {
      clusterToken: "cluster_token",
    });
    expect(queryMap).toHaveBeenCalledTimes(2);
    expect(controller.state.changeCursor).toBe("change_query_02");
  });
});

function createController(
  client: LoomTableClient,
  view: View,
  fields: readonly Field[],
  renderer: FakeRenderer = new FakeRenderer(),
): MapViewController {
  return new MapViewController(client, view, fields, {
    renderer,
    registry: new TileProviderRegistry(),
    credentials: emptyCredentials,
    provider: { kind: "built-in", id: "osm-standard" },
    viewport: {
      getViewport: () => ({
        boxes: [{ west: -10, south: -10, east: 10, north: 10 }],
      }),
      getPixelSize: () => ({ width: 800, height: 600 }),
    },
  });
}

function createClient(
  overrides: Partial<Record<keyof LoomTableClient, unknown>> = {},
): LoomTableClient {
  return {
    getMeta: vi.fn(),
    checkConnection: vi.fn(),
    listWorkspaces: vi.fn(),
    listBases: vi.fn(),
    listTables: vi.fn(),
    listFields: vi.fn(),
    listViews: vi.fn(),
    query: vi.fn(),
    mutate: vi.fn(),
    getRecord: vi.fn(),
    queryMap: vi.fn().mockResolvedValue(clusterResult("change_query_00")),
    summarizeMap: vi.fn(),
    queryMapClusterRecords: vi.fn(),
    updateView: vi.fn(),
    initializeAttachment: vi.fn(),
    getAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    uploadAttachmentContent: vi.fn(),
    downloadAttachmentContent: vi.fn(),
    ...overrides,
  } as LoomTableClient;
}

const emptyCredentials: TileCredentialReader = { get: () => null };

class FakeRenderer implements MapRenderer {
  features: MapQueryResult["features"] = [];

  mount(_container: HTMLElement, _listener: MapRendererEventListener): void {}
  setTilePlan(): void {}
  setCamera(): void {}
  fitBounds(): void {}
  setFeatures(features: MapQueryResult["features"]): void {
    this.features = features;
  }
  invalidateSize(): void {}
  destroy(): void {}
}

function createField(id: string): Field {
  return {
    id,
    tableId: "table_01",
    name: "Location",
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: "location",
    config: {},
  };
}

function createMapView(): Extract<View, { type: "map" }> {
  return {
    id: "view_map",
    tableId: "table_01",
    name: "Map",
    type: "map",
    config: { locationFieldId: "field_location" },
    revision: 1,
    createdAt: "",
    updatedAt: "",
  };
}

function clusterResult(changeCursor: string): MapQueryResult {
  return {
    features: [
      {
        kind: "cluster",
        clusterId: "cluster_01",
        position: { lat: 1, lng: 2 },
        bounds: { boxes: [{ west: 0, south: 0, east: 3, north: 3 }] },
        pointCount: 2,
        recordsQueryToken: "cluster_token",
      },
    ],
    viewportRenderableRecordCount: 2,
    viewRevision: 1,
    changeCursor,
  };
}

import { describe, expect, it, vi } from "vitest";

import { HttpLoomTableClient } from "../../src/client/http-loomtable-client";
import type {
  HttpTransport,
  HttpTransportResponse,
} from "../../src/client/http-transport";

describe("HttpLoomTableClient Map A1 contract", () => {
  it("sends Summary as a bodyless POST and preserves invalid-coordinate counts", async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        summary: {
          matchedRecordCount: 3,
          renderableRecordCount: 1,
          unlocatedRecordCount: 1,
          unrenderableRecordCount: 1,
        },
        viewRevision: 7,
        changeCursor: "change_summary_07",
      }),
    ]);

    await expect(
      createClient(transport).summarizeMap("view/07"),
    ).resolves.toMatchObject({
      summary: {
        matchedRecordCount: 3,
        renderableRecordCount: 1,
        unlocatedRecordCount: 1,
        unrenderableRecordCount: 1,
      },
      viewRevision: 7,
      changeCursor: "change_summary_07",
    });
    expect(transport).toHaveBeenCalledWith({
      url: "https://loom.example/v1/views/view%2F07/map/summary",
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token",
      },
    });
  });

  it.each([
    [400, "INVALID_CURSOR"],
    [410, "QUERY_SNAPSHOT_EXPIRED"],
  ] as const)(
    "maps HTTP %d %s to refreshable cursor expiry",
    async (status, code) => {
      const transport = queuedTransport([
        jsonResponse(status, {
          error: {
            code,
            message: "Refresh the Map query.",
            requestId: `req_${status}`,
            details: {},
          },
        }),
      ]);

      await expect(
        createClient(transport).queryMapClusterRecords("view_07", {
          clusterToken: "cluster_token",
        }),
      ).rejects.toMatchObject({
        kind: "cursor-expired",
        details: { httpStatus: status, code },
      });
    },
  );
});

function createClient(transport: HttpTransport): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: "https://loom.example",
      pluginVersion: "0.1.1",
      accessToken: () => "token",
    },
    transport,
    { delay: () => Promise.resolve() },
  );
}

function queuedTransport(
  responses: Array<HttpTransportResponse | Promise<HttpTransportResponse>>,
): ReturnType<typeof vi.fn<HttpTransport>> {
  return vi.fn<HttpTransport>(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected HTTP request.");
    return response;
  });
}

function jsonResponse(status: number, body: unknown): HttpTransportResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

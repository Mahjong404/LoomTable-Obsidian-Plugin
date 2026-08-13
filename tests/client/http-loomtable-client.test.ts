import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

const compatibleMeta = {
  serverVersion: '0.1.0',
  apiVersion: 'v1',
  minPluginVersion: '0.1.0',
  capabilities: ['grid', 'map'],
  changeRetention: '30d',
  idempotencyRetention: '30d',
  migrationRequired: false,
  bootstrapState: 'complete',
};

describe('HttpLoomTableClient connection checks', () => {
  it('enforces transport-safe Server origins at the client seam', () => {
    const transport = queuedTransport([]);

    expect(
      () =>
        new HttpLoomTableClient(
          {
            serverOrigin: 'http://loom.example',
            pluginVersion: '0.1.0',
            accessToken: () => 'token',
          },
          transport,
        ),
    ).toThrow('Non-loopback server origins must use HTTPS.');
    expect(transport).not.toHaveBeenCalled();
  });

  it('reads and decodes public Server metadata', async () => {
    const transport = queuedTransport([jsonResponse(200, compatibleMeta)]);
    const client = createClient(transport);

    await expect(client.getMeta()).resolves.toEqual(compatibleMeta);
    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/meta',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });

  it('requires a token after confirming Server compatibility', async () => {
    const transport = queuedTransport([jsonResponse(200, compatibleMeta)]);
    const client = createClient(transport, null);

    await expect(client.checkConnection()).resolves.toMatchObject({
      kind: 'authentication-required',
      meta: compatibleMeta,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('requires authentication when a remembered secret cannot be read', async () => {
    const transport = queuedTransport([jsonResponse(200, compatibleMeta)]);
    const client = new HttpLoomTableClient(
      {
        serverOrigin: 'https://loom.example',
        pluginVersion: '0.1.0',
        accessToken: () => {
          throw new Error('Secret is unavailable.');
        },
      },
      transport,
    );

    await expect(client.checkConnection()).resolves.toMatchObject({
      kind: 'authentication-required',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('validates a token using a read-only workspace request', async () => {
    const transport = queuedTransport([
      jsonResponse(200, compatibleMeta),
      jsonResponse(200, { items: [] }),
    ]);
    const client = createClient(transport, 'session-token');

    await expect(client.checkConnection()).resolves.toMatchObject({ kind: 'connected' });
    expect(transport).toHaveBeenLastCalledWith({
      url: 'https://loom.example/v1/workspaces',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer session-token' },
    });
  });

  it('reports rejected authentication with safe diagnostics', async () => {
    const transport = queuedTransport([
      jsonResponse(200, compatibleMeta),
      jsonResponse(401, {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Missing or invalid token.',
          requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
      }),
    ]);
    const client = createClient(transport);

    await expect(client.checkConnection()).resolves.toEqual({
      kind: 'authentication-failed',
      meta: compatibleMeta,
      error: {
        message: 'Missing or invalid token.',
        httpStatus: 401,
        code: 'UNAUTHENTICATED',
        requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
    });
  });

  it.each([
    [
      { ...compatibleMeta, apiVersion: 'v2' },
      { kind: 'api-version', expectedApiVersion: 'v1', actualApiVersion: 'v2' },
    ],
    [
      { ...compatibleMeta, minPluginVersion: '0.2.0' },
      { kind: 'plugin-version', currentPluginVersion: '0.1.0', minimumPluginVersion: '0.2.0' },
    ],
    [{ ...compatibleMeta, migrationRequired: true }, { kind: 'migration-required' }],
  ])('reports incompatible metadata without sending credentials', async (meta, reason) => {
    const transport = queuedTransport([jsonResponse(200, meta)]);
    const client = createClient(transport);

    await expect(client.checkConnection()).resolves.toMatchObject({
      kind: 'incompatible',
      reason,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('accepts a Plugin version newer than the Server minimum', async () => {
    const transport = queuedTransport([
      jsonResponse(200, { ...compatibleMeta, minPluginVersion: '0.0.9' }),
      jsonResponse(200, { items: [] }),
    ]);

    await expect(createClient(transport).checkConnection()).resolves.toMatchObject({
      kind: 'connected',
    });
  });

  it('retries transient metadata failures twice', async () => {
    const delays: number[] = [];
    const transport = queuedTransport([
      Promise.reject(new Error('offline')),
      jsonResponse(503, {
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Retry.', requestId: 'req_retry' },
      }),
      jsonResponse(200, compatibleMeta),
    ]);
    const client = createClient(transport, null, {
      delay: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
      random: () => 0.5,
    });

    await expect(client.checkConnection()).resolves.toMatchObject({
      kind: 'authentication-required',
    });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([250, 500]);
  });

  it('does not retry a migration-required response', async () => {
    const transport = queuedTransport([
      jsonResponse(503, {
        error: { code: 'MIGRATION_REQUIRED', message: 'Migrate first.', requestId: 'req_migrate' },
      }),
    ]);

    await expect(createClient(transport).checkConnection()).resolves.toMatchObject({
      kind: 'incompatible',
      reason: { kind: 'migration-required' },
      error: { code: 'MIGRATION_REQUIRED', httpStatus: 503 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('maps migration-required from the authenticated probe to incompatibility', async () => {
    const transport = queuedTransport([
      jsonResponse(200, compatibleMeta),
      jsonResponse(503, {
        error: { code: 'MIGRATION_REQUIRED', message: 'Migrate first.', requestId: 'req_migrate' },
      }),
    ]);

    await expect(createClient(transport).checkConnection()).resolves.toMatchObject({
      kind: 'incompatible',
      meta: compatibleMeta,
      reason: { kind: 'migration-required' },
      error: { code: 'MIGRATION_REQUIRED', httpStatus: 503 },
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed metadata at the transport boundary', async () => {
    const transport = queuedTransport([jsonResponse(200, { apiVersion: 'v1' })]);

    await expect(createClient(transport).checkConnection()).resolves.toMatchObject({
      kind: 'server-error',
      error: { message: 'The LoomTable Server returned invalid compatibility metadata.' },
    });
  });
});

function createClient(
  transport: HttpTransport,
  token: string | null = 'token',
  options: ConstructorParameters<typeof HttpLoomTableClient>[2] = {},
): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: 'https://loom.example',
      pluginVersion: '0.1.0',
      accessToken: () => token,
    },
    transport,
    { delay: () => Promise.resolve(), ...options },
  );
}

function queuedTransport(
  responses: Array<HttpTransportResponse | Promise<HttpTransportResponse>>,
): ReturnType<typeof vi.fn<HttpTransport>> {
  return vi.fn<HttpTransport>(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected HTTP request.');
    return response;
  });
}

function jsonResponse(status: number, body: unknown): HttpTransportResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

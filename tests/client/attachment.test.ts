import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

const pendingAttachment = {
  id: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  source: 'managed',
  status: 'pending',
  filename: 'photo.png',
  mimeType: 'image/png',
  revision: 1,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
};

const readyAttachment = {
  ...pendingAttachment,
  status: 'ready',
  size: 3,
  hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('HttpLoomTableClient Attachment P1 contract', () => {
  it('decodes Attachment Field metadata during resource discovery', async () => {
    const field = {
      id: 'fld_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tableId: 'tbl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Files',
      position: 1,
      schemaVersion: 1,
      revision: 1,
      type: 'attachment',
      config: { maxCount: 3 },
    };
    const transport = queuedTransport([jsonResponse(200, { items: [field] })]);

    await expect(createClient(transport).listFields(field.tableId)).resolves.toEqual([field]);
  });

  it('initializes, uploads, reads, deletes, and downloads Attachments through the transport seam', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const transport = queuedTransport([
      jsonResponse(201, pendingAttachment),
      jsonResponse(200, readyAttachment),
      jsonResponse(200, readyAttachment),
      { status: 204, headers: {}, body: '' },
      { status: 200, headers: { 'Content-Type': 'image/png' }, body: '', bytes },
    ]);
    const client = createClient(transport);
    const request = {
      source: 'managed' as const,
      filename: 'photo.png',
      mimeType: 'image/png',
      size: 3,
    };

    await expect(
      client.initializeAttachment(request, 'mut_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    ).resolves.toEqual(pendingAttachment);
    await expect(
      client.uploadAttachmentContent(pendingAttachment.id, bytes, 'image/png'),
    ).resolves.toEqual(readyAttachment);
    await expect(client.getAttachment(pendingAttachment.id)).resolves.toEqual(readyAttachment);
    await expect(client.deleteAttachment(pendingAttachment.id, 1)).resolves.toBeUndefined();
    await expect(client.downloadAttachmentContent(pendingAttachment.id)).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    });

    expect(transport).toHaveBeenNthCalledWith(1, {
      url: 'https://loom.example/v1/attachments/init',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mut_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      body: JSON.stringify(request),
    });
    expect(transport).toHaveBeenNthCalledWith(2, {
      url: 'https://loom.example/v1/attachments/' + pendingAttachment.id + '/content',
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'image/png',
      },
      body: bytes,
    });
    expect(transport).toHaveBeenNthCalledWith(4, {
      url: 'https://loom.example/v1/attachments/' + pendingAttachment.id + '?expectedRevision=1',
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
    expect(transport).toHaveBeenNthCalledWith(5, {
      url: 'https://loom.example/v1/attachments/' + pendingAttachment.id + '/content',
      method: 'GET',
      headers: { Accept: '*/*', Authorization: 'Bearer token' },
    });
  });

  it('keeps disabled Attachment capability distinct from a missing resource', async () => {
    const transport = queuedTransport([
      jsonResponse(501, {
        error: {
          code: 'CAPABILITY_NOT_ENABLED',
          message: 'Attachments are disabled.',
          requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
      }),
    ]);

    await expect(createClient(transport).getAttachment(pendingAttachment.id)).rejects.toMatchObject(
      {
        kind: 'capability',
        details: { httpStatus: 501, code: 'CAPABILITY_NOT_ENABLED' },
      },
    );
  });
});

function createClient(
  transport: HttpTransport,
  token: string | null = 'token',
): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: 'https://loom.example',
      pluginVersion: '0.1.0',
      accessToken: () => token,
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
    if (response === undefined) throw new Error('Unexpected HTTP request.');
    return response;
  });
}

function jsonResponse(status: number, body: unknown): HttpTransportResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

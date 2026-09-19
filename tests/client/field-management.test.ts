import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

const TEXT_FIELD = {
  id: 'field_notes',
  tableId: 'table_01',
  name: 'Notes',
  type: 'text',
  config: {},
  position: 3,
  schemaVersion: 1,
  revision: 2,
};

describe('HttpLoomTableClient Field management', () => {
  it('creates a Field with the idempotency header and typed config body', async () => {
    const transport = queuedTransport([jsonResponse(201, TEXT_FIELD)]);
    const client = createClient(transport);

    const field = await client.createField(
      'table_01',
      { name: 'Notes', type: 'text', config: {} },
      'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
    );

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table_01/fields',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      },
      body: JSON.stringify({ name: 'Notes', type: 'text', config: {} }),
    });
    expect(field).toMatchObject({ id: 'field_notes', type: 'text', position: 3, revision: 2 });
  });

  it('creates a Select Field with option input including colors', async () => {
    const transport = queuedTransport([
      jsonResponse(201, {
        ...TEXT_FIELD,
        id: 'field_status',
        name: 'Status',
        type: 'select',
        config: {
          options: [
            { id: 'option_1', name: 'Todo', color: 'gray' },
            { id: 'option_2', name: 'Done', color: 'green' },
          ],
          deletedOptions: [],
        },
      }),
    ]);
    const client = createClient(transport);

    const field = await client.createField(
      'table_01',
      {
        name: 'Status',
        type: 'select',
        config: {
          options: [
            { name: 'Todo', color: 'gray' },
            { name: 'Done', color: 'green' },
          ],
        },
      },
      'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
    );

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://loom.example/v1/tables/table_01/fields',
        method: 'POST',
        body: JSON.stringify({
          name: 'Status',
          type: 'select',
          config: {
            options: [
              { name: 'Todo', color: 'gray' },
              { name: 'Done', color: 'green' },
            ],
          },
        }),
      }),
    );
    expect(field).toMatchObject({
      type: 'select',
      config: { options: [{ name: 'Todo' }, { name: 'Done' }] },
    });
  });

  it('rejects a blank Field name before any request', async () => {
    const transport = queuedTransport([]);
    const client = createClient(transport);

    await expect(
      client.createField(
        'table_01',
        { name: '   ', type: 'text', config: {} },
        'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('patches a Field name with the type echo and expected revision', async () => {
    const transport = queuedTransport([
      jsonResponse(200, { ...TEXT_FIELD, name: 'Summary', revision: 3 }),
    ]);
    const client = createClient(transport);

    const field = await client.updateField('field_notes', {
      type: 'text',
      expectedRevision: 2,
      name: 'Summary',
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/fields/field_notes',
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'text', expectedRevision: 2, name: 'Summary' }),
    });
    expect(field).toMatchObject({ name: 'Summary', revision: 3 });
  });

  it('replaces Select options through a config-only patch', async () => {
    const transport = queuedTransport([jsonResponse(200, { ...TEXT_FIELD, revision: 3 })]);
    const client = createClient(transport);

    await client.updateField('field_status', {
      type: 'select',
      expectedRevision: 2,
      config: { options: [{ id: 'option_1', name: 'Todo', color: 'blue' }] },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          type: 'select',
          expectedRevision: 2,
          config: { options: [{ id: 'option_1', name: 'Todo', color: 'blue' }] },
        }),
      }),
    );
  });

  it('round-trips a Number Field display format and accepts a legacy empty config', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        ...TEXT_FIELD,
        type: 'number',
        config: { format: { thousandsSeparator: true, decimals: 2, currency: 'CNY' } },
        revision: 3,
      }),
      jsonResponse(200, {
        ...TEXT_FIELD,
        id: 'field_legacy',
        type: 'number',
        config: {},
      }),
    ]);
    const client = createClient(transport);

    const formatted = await client.updateField('field_notes', {
      type: 'number',
      expectedRevision: 2,
      config: { format: { thousandsSeparator: true, decimals: 2, currency: 'CNY' } },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          type: 'number',
          expectedRevision: 2,
          config: { format: { thousandsSeparator: true, decimals: 2, currency: 'CNY' } },
        }),
      }),
    );
    expect(formatted).toMatchObject({
      type: 'number',
      config: { format: { thousandsSeparator: true, decimals: 2, currency: 'CNY' } },
    });

    const legacy = await client.updateField('field_legacy', {
      type: 'number',
      expectedRevision: 2,
      name: 'Legacy',
    });
    expect(legacy).toMatchObject({ type: 'number', config: {} });
  });

  it('rejects an update carrying neither name nor config', async () => {
    const transport = queuedTransport([]);
    const client = createClient(transport);

    await expect(
      client.updateField('field_notes', { type: 'text', expectedRevision: 2 }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('deletes a Field with the expected revision query parameter', async () => {
    const transport = queuedTransport([{ status: 204, headers: {}, body: '' }]);
    const client = createClient(transport);

    await client.deleteField('field_notes', 2);

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/fields/field_notes?expectedRevision=2',
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
  });

  it('restores a Field through the restore endpoint', async () => {
    const transport = queuedTransport([jsonResponse(200, { ...TEXT_FIELD, revision: 4 })]);
    const client = createClient(transport);

    const field = await client.restoreField('field_notes', 3);

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/fields/field_notes/restore',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedRevision: 3 }),
    });
    expect(field).toMatchObject({ id: 'field_notes', revision: 4 });
  });
});

function createClient(transport: HttpTransport): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: 'https://loom.example',
      pluginVersion: '0.1.0',
      accessToken: () => 'token',
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

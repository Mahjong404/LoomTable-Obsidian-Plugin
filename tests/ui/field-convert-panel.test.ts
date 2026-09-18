import { describe, expect, it, vi } from 'vitest';

import type { ConversionPreview, Field } from '../../src/client/loomtable-client';
import { LoomTableClientError } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { openFieldConverter } from '../../src/ui/field-convert-panel';

const FIELD: Field = {
  id: 'field_01',
  tableId: 'table_01',
  name: 'Name',
  position: 0,
  schemaVersion: 1,
  revision: 4,
  type: 'text',
  config: {},
};

function host(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollWidth', { value: 800 });
  Object.defineProperty(el, 'scrollHeight', { value: 600 });
  document.body.append(el);
  return el;
}

const PREVIEW: ConversionPreview = {
  supported: true,
  totalRecords: 12,
  previewToken: 'tok_1',
  modes: [
    {
      id: 'strict',
      label: 'Strict',
      stats: { ok: 10, lossy: 1, lost: 1, empty: 0 },
    },
    {
      id: 'options',
      label: 'Create options',
      disabled: true,
      reason: 'Too many distinct values.',
      stats: { ok: 0, lossy: 0, lost: 0, empty: 0, distinctValues: 600, newOptions: 600 },
    },
  ],
};

describe('openFieldConverter', () => {
  it('previews the picked type, applies the selected mode, and closes', async () => {
    const container = host();
    const onPreview = vi.fn(async () => PREVIEW);
    const onConvert = vi.fn(async () => ({}));
    openFieldConverter({
      field: FIELD,
      x: 10,
      y: 10,
      host: container,
      translate: createTranslator('en'),
      onPreview,
      onConvert,
    });

    const panel = container.querySelector<HTMLElement>('.loom-convert-panel');
    expect(panel).not.toBeNull();
    container
      .querySelector<HTMLButtonElement>('.loom-field-editor-type[data-type="number"]')
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onPreview).toHaveBeenCalledWith('field_01', 'number');

    const modes = panel?.querySelectorAll<HTMLButtonElement>('.loom-convert-mode') ?? [];
    expect(modes).toHaveLength(2);
    expect(modes[1]?.disabled).toBe(true);
    expect(modes[1]?.querySelector('.loom-convert-mode-reason')?.textContent).toContain('Too many');

    const apply = panel?.querySelector<HTMLButtonElement>('.loom-convert-apply');
    expect(apply?.disabled).toBe(true);
    modes[0]?.click();
    expect(apply?.disabled).toBe(false);
    expect(panel?.querySelector<HTMLElement>('.loom-convert-warning')?.hidden).toBe(false);

    apply?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onConvert).toHaveBeenCalledWith('field_01', {
      type: 'number',
      mode: 'strict',
      expectedRevision: 4,
      previewToken: 'tok_1',
    });
    expect(container.querySelector('.loom-convert-panel')).toBeNull();
    container.remove();
  });

  it('shows the unsupported reason and offers no apply button', async () => {
    const container = host();
    const onPreview = vi.fn(async () => ({
      supported: false,
      reason: 'Attachments cannot convert.',
      totalRecords: 0,
    }));
    openFieldConverter({
      field: FIELD,
      x: 10,
      y: 10,
      host: container,
      translate: createTranslator('en'),
      onPreview,
      onConvert: vi.fn(),
    });
    container
      .querySelector<HTMLButtonElement>('.loom-field-editor-type[data-type="select"]')
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    const panel = container.querySelector<HTMLElement>('.loom-convert-panel');
    expect(panel?.querySelector('.loom-convert-status')?.textContent).toContain(
      'Attachments cannot convert.',
    );
    expect(panel?.querySelector('.loom-convert-apply')).toBeNull();
    container.remove();
  });

  it('re-previews once when the Server reports a stale preview token', async () => {
    const container = host();
    const onPreview = vi.fn(async () => PREVIEW);
    const stale = new LoomTableClientError('conflict', {
      message: 'stale',
      httpStatus: 409,
      code: 'CONVERT_PREVIEW_STALE',
    });
    const onConvert = vi
      .fn<(fieldId: string, request: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({});
    openFieldConverter({
      field: FIELD,
      x: 10,
      y: 10,
      host: container,
      translate: createTranslator('en'),
      onPreview,
      onConvert,
    });
    container
      .querySelector<HTMLButtonElement>('.loom-field-editor-type[data-type="number"]')
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    const panel = container.querySelector<HTMLElement>('.loom-convert-panel');
    panel?.querySelector<HTMLButtonElement>('.loom-convert-mode')?.click();
    panel?.querySelector<HTMLButtonElement>('.loom-convert-apply')?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onConvert).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(2);
    container.remove();
  });
});

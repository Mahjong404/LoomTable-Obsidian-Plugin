import { describe, expect, it, vi } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  createFieldEditor,
  createFieldRendererRegistry,
  createRenderedFieldValueElement,
} from '../../src/ui/field-renderer-registry';

const registry = createFieldRendererRegistry();

describe('Field renderer registry', () => {
  it('keeps Unset, Cleared, and a natural empty Text value distinct', () => {
    const field = createField('text');
    const translate = createTranslator('en');

    expect(registry.render(field, undefined, { translate })).toMatchObject({
      state: 'unset',
      text: 'Unset',
      ariaLabel: 'Unset',
    });
    expect(registry.render(field, null, { translate })).toMatchObject({
      state: 'cleared',
      text: 'Cleared',
      ariaLabel: 'Cleared',
    });
    expect(registry.render(field, '', { translate })).toMatchObject({
      state: 'empty',
      text: 'Empty',
      ariaLabel: 'Empty',
    });
  });

  it('uses translated semantics for checkbox, Location, and natural empty MultiSelect', () => {
    const translate = createTranslator('zh-CN');
    const checkbox = createField('checkbox');
    const location = createField('location');
    const multiSelect = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [],
    });

    expect(registry.render(checkbox, true, { translate })).toMatchObject({
      state: 'value',
      text: '已选中',
      ariaLabel: '已选中',
    });
    expect(registry.render(location, { label: 'Office' }, { translate })).toMatchObject({
      state: 'unlocated',
      text: '未定位',
      ariaLabel: '未定位',
    });
    expect(registry.render(multiSelect, [], { translate })).toMatchObject({
      state: 'empty',
      text: '空',
      ariaLabel: '空',
    });
  });

  it('renders the existing scalar field types without weakening URL safety', () => {
    const translate = createTranslator('en');
    expect(registry.render(createField('longText'), 'A longer note', { translate }).text).toBe(
      'A longer note',
    );
    expect(registry.render(createField('number'), 42, { translate }).text).toBe('42');
    expect(registry.render(createField('date'), '2026-08-31', { translate }).text).toBe(
      '2026-08-31',
    );
    expect(registry.render(createField('date'), '', { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Value unavailable',
    });
    expect(registry.render(createField('url'), 'https://example.com', { translate }).text).toBe(
      'https://example.com',
    );
    expect(registry.render(createField('url'), '', { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Value unavailable',
      ariaLabel: 'Value unavailable',
    });
  });

  it('does not present invalid Date wire values as ordinary values', () => {
    const translate = createTranslator('zh-CN');
    const field = createField('date');

    expect(registry.render(field, '2026-02-31', { translate })).toMatchObject({
      state: 'unavailable',
      text: '值不可用',
      ariaLabel: '值不可用',
    });
    expect(registry.render(field, ' 2026-02-28 ', { translate })).toMatchObject({
      state: 'value',
      text: '2026-02-28',
      ariaLabel: '2026-02-28',
    });
  });

  it('renders only absolute HTTP(S) URLs as accessible links', () => {
    const translate = createTranslator('zh-CN');
    const field = createField('url');
    const rendered = registry.render(field, ' https://example.com/docs?q=1 ', { translate });
    const element = createRenderedFieldValueElement(rendered);
    const link = element.querySelector<HTMLAnchorElement>('.loom-field-value-link');

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/docs?q=1');
    expect(link?.textContent).toBe('https://example.com/docs?q=1');
    expect(link?.getAttribute('aria-label')).toBe('打开 URL： https://example.com/docs?q=1');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');

    const httpRendered = registry.render(field, 'http://example.com/docs', { translate });
    expect(httpRendered.link?.href).toBe('http://example.com/docs');

    for (const value of ['ftp://example.com/file', 'javascript:alert(1)', '/relative/path']) {
      const unsafe = createRenderedFieldValueElement(registry.render(field, value, { translate }));
      expect(unsafe.querySelector('.loom-field-value-link')).toBeNull();
      expect(unsafe.dataset.valueState).toBe('unavailable');
      expect(unsafe.textContent).toBe('值不可用');
      expect(unsafe.textContent).not.toContain(value);
    }
  });

  it('renders option names and structured attachment metadata without raw IDs or JSON', () => {
    const translate = createTranslator('en');
    const select = createField('select', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const multiSelect = createField('multiSelect', select.config);
    const attachment = createField('attachment', { maxCount: 10 });

    expect(registry.render(select, 'option_1', { translate }).text).toBe('One');
    expect(registry.render(multiSelect, ['option_old', 'option_1'], { translate }).text).toBe(
      'Old (Deleted option), One',
    );
    const renderedAttachment = registry.render(
      attachment,
      [
        {
          id: 'attachment_1',
          source: 'vault',
          filename: 'notes.md',
          mimeType: 'text/markdown',
          size: 2048,
        },
      ],
      { translate },
    );
    expect(renderedAttachment.text).toBe(
      'notes.md · Source: Vault · Type: text/markdown · Size: 2 KB · Ready',
    );
    expect(renderedAttachment.text).not.toContain('attachment_1');
    expect(renderedAttachment.text).not.toContain('{');
  });

  it('normalizes attachment states and preserves the published ref boundary', () => {
    const translate = createTranslator('en');
    const field = createField('attachment', { maxCount: 10 });
    const rendered = registry.render(
      field,
      [
        {
          id: 'attachment_ready',
          source: 'vault',
          filename: 'ready.md',
          mimeType: 'text/markdown',
          size: 2048,
        },
        {
          id: 'attachment_pending',
          source: 'managed',
          filename: 'pending.png',
          status: 'pending',
        },
        {
          id: 'attachment_stale',
          source: 'vault',
          filename: 'stale.pdf',
          status: 'ready',
          deletedAt: '2026-08-31T00:00:00Z',
        },
        {
          id: 'attachment_unknown',
          source: 'vault',
          filename: 'unknown.bin',
          status: 'unknown',
        },
        { id: 'attachment_incomplete', source: 'vault' },
      ],
      { translate },
    );

    expect(rendered.state).toBe('value');
    expect(rendered.attachments).toMatchObject([
      {
        state: 'ready',
        id: 'attachment_ready',
        filename: 'ready.md',
        source: 'vault',
        sourceText: 'Vault',
        statusText: 'Ready',
        mimeType: 'text/markdown',
        sizeText: '2 KB',
      },
      {
        state: 'pending',
        id: 'attachment_pending',
        source: 'managed',
        statusText: 'Pending',
      },
      { state: 'stale', id: 'attachment_stale', statusText: 'Stale reference' },
      { state: 'unknown', id: 'attachment_unknown', statusText: 'Unknown attachment reference' },
      { state: 'invalid', statusText: 'Invalid attachment reference' },
    ]);
    expect(rendered.ariaLabel).toContain('Source: Vault');
    expect(rendered.ariaLabel).toContain('Pending');
    expect(rendered.ariaLabel).toContain('Stale reference');
    expect(rendered.ariaLabel).not.toContain('attachment_ready');
    expect(rendered.ariaLabel).not.toContain('"filename"');

    const zhRendered = registry.render(
      field,
      [{ id: 'attachment_zh', source: 'managed', filename: '说明.pdf' }],
      { translate: createTranslator('zh-CN') },
    );
    expect(zhRendered.text).toContain('来源: 托管');
    expect(zhRendered.text).toContain('已就绪');
    expect(zhRendered.ariaLabel).not.toContain('attachment_zh');

    expect(registry.render(field, undefined, { translate }).text).toBe('Unset');
    expect(registry.render(field, null, { translate }).text).toBe('Cleared');
    expect(registry.render(field, [], { translate })).toMatchObject({
      state: 'empty',
      text: 'Empty',
      attachments: [],
    });
    expect(
      registry.render(field, [{ id: 'bad', source: 'remote', filename: 'unknown.bin' }], {
        translate,
      }),
    ).toMatchObject({ state: 'unavailable' });
  });

  it('renders attachment cards and a compact summary without leaking identifiers', async () => {
    const translate = createTranslator('en');
    const field = createField('attachment', { maxCount: 10 });
    const rendered = registry.render(
      field,
      [
        {
          id: 'attachment_1',
          source: 'vault',
          filename: 'notes.md',
          vaultPath: 'attachments/notes.md',
          size: 2048,
        },
        { id: 'attachment_2', source: 'managed', filename: 'image.png', status: 'pending' },
      ],
      { translate },
    );

    const detail = createRenderedFieldValueElement(rendered);
    expect(detail.querySelector('.loom-attachment-list')).not.toBeNull();
    expect(detail.querySelectorAll('.loom-attachment-card')).toHaveLength(2);
    expect(detail.querySelector('.loom-attachment-filename')?.textContent).toBe('notes.md');
    expect(detail.querySelector('.loom-attachment-status')?.textContent).toBe('Ready');
    expect(detail.textContent).toContain('Source: Vault');
    expect(detail.textContent).toContain('Pending');
    expect(detail.innerHTML).not.toContain('attachment_1');
    expect(detail.innerHTML).not.toContain('"filename"');
    expect(detail.querySelector('button')).toBeNull();

    const compact = createRenderedFieldValueElement(rendered, { compactAttachments: true });
    expect(compact.querySelector('.loom-attachment-list')).toBeNull();
    expect(compact.textContent).toContain('2 attachments');
    expect(compact.textContent).toContain('notes.md');

    const onDownload = vi.fn(async (attachmentId: string | undefined): Promise<void> => {
      void attachmentId;
    });
    const actionable = createRenderedFieldValueElement(rendered, {
      translate,
      onAttachmentDownload: (attachment) => onDownload(attachment.id),
    });
    const download = actionable.querySelector<HTMLButtonElement>('.loom-attachment-action');
    expect(download?.textContent).toBe('Download');
    download?.click();
    download?.click();
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
  });

  it('exposes typed Open and Preview actions only for ready attachments and guards duplicate activation', async () => {
    const translate = createTranslator('en');
    const field = createField('attachment', { maxCount: 10 });
    const rendered = registry.render(
      field,
      [{ id: 'attachment_1', source: 'vault', filename: 'notes.md' }],
      { translate },
    );
    const onOpen = vi.fn(async (): Promise<void> => undefined);
    const onPreview = vi.fn(async (): Promise<void> => {
      throw new Error('secret path');
    });
    const element = createRenderedFieldValueElement(rendered, {
      translate,
      onAttachmentOpen: onOpen,
      onAttachmentPreview: onPreview,
    });

    const open = element.querySelector<HTMLButtonElement>('.loom-attachment-open-action');
    const preview = element.querySelector<HTMLButtonElement>('.loom-attachment-preview-action');
    expect(open?.textContent).toBe('Open');
    expect(preview?.textContent).toBe('Preview');
    expect(open?.getAttribute('aria-label')).toBe('Open notes.md');
    expect(preview?.getAttribute('aria-label')).toBe('Preview notes.md');
    expect(open?.parentElement?.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(preview?.parentElement?.querySelector('[aria-live="polite"]')).not.toBeNull();

    open?.focus();
    open?.click();
    open?.click();
    preview?.focus();
    preview?.click();
    preview?.click();

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(element.querySelector('.loom-attachment-preview-action-status')?.textContent).toBe(
        'Preview failed. Check the attachment and try again.',
      ),
    );
    expect(element.textContent).not.toContain('secret path');
  });

  it('does not expose Open or Preview for unavailable attachments or without callbacks', () => {
    const translate = createTranslator('en');
    const field = createField('attachment', { maxCount: 10 });
    const ready = registry.render(
      field,
      [{ id: 'attachment_1', source: 'vault', filename: 'notes.md' }],
      { translate },
    );
    const withoutCallbacks = createRenderedFieldValueElement(ready, { translate });
    expect(withoutCallbacks.querySelector('.loom-attachment-open-action')).toBeNull();
    expect(withoutCallbacks.querySelector('.loom-attachment-preview-action')).toBeNull();
    const offlineWithoutCallbacks = createRenderedFieldValueElement(ready, {
      translate,
      attachmentOpenPreviewDisabled: true,
    });
    expect(offlineWithoutCallbacks.querySelector('.loom-attachment-open-action')).toBeNull();
    expect(offlineWithoutCallbacks.querySelector('.loom-attachment-preview-action')).toBeNull();

    const pending = registry.render(
      field,
      [{ id: 'attachment_1', source: 'vault', filename: 'notes.md', status: 'pending' }],
      { translate },
    );
    const onOpen = vi.fn();
    const onPreview = vi.fn();
    const unavailable = createRenderedFieldValueElement(pending, {
      translate,
      onAttachmentOpen: onOpen,
      onAttachmentPreview: onPreview,
    });
    expect(unavailable.querySelector('.loom-attachment-open-action')).toBeNull();
    expect(unavailable.querySelector('.loom-attachment-preview-action')).toBeNull();
  });

  it('does not expose a download action for an unsafe Vault path', () => {
    const translate = createTranslator('en');
    const field = createField('attachment', { maxCount: 10 });
    const rendered = registry.render(
      field,
      [{ id: 'attachment_1', source: 'vault', filename: 'notes.md', vaultPath: '../notes.md' }],
      { translate },
    );

    const element = createRenderedFieldValueElement(rendered, {
      translate,
      onAttachmentDownload: vi.fn(),
    });

    expect(element.querySelector('.loom-attachment-action')).toBeNull();
  });

  it('disables Open and Preview offline with a translated accessible explanation', () => {
    const translate = createTranslator('zh-CN');
    const field = createField('attachment', { maxCount: 10 });
    const rendered = registry.render(
      field,
      [{ id: 'attachment_1', source: 'vault', filename: 'notes.md' }],
      { translate },
    );
    const onOpen = vi.fn();
    const onPreview = vi.fn();
    const element = createRenderedFieldValueElement(rendered, {
      translate,
      attachmentOpenPreviewDisabled: true,
      onAttachmentOpen: onOpen,
      onAttachmentPreview: onPreview,
    });

    const open = element.querySelector<HTMLButtonElement>('.loom-attachment-open-action');
    const preview = element.querySelector<HTMLButtonElement>('.loom-attachment-preview-action');
    expect(open?.disabled).toBe(true);
    expect(preview?.disabled).toBe(true);
    expect(open?.getAttribute('aria-label')).toBe('当前离线；恢复连接后才能打开或预览。');
    expect(preview?.getAttribute('aria-label')).toBe('当前离线；恢复连接后才能打开或预览。');
    expect(element.querySelector('.loom-attachment-open-action-status')?.textContent).toBe(
      '当前离线；恢复连接后才能打开或预览。',
    );
    open?.click();
    preview?.click();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('publishes MultiSelect values as semantic chips instead of a comma string', () => {
    const translate = createTranslator('en');
    const field = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });

    expect(registry.render(field, ['option_old', 'option_1'], { translate })).toMatchObject({
      state: 'value',
      chips: [
        { state: 'deleted', text: 'Old', ariaLabel: 'Old (Deleted option)' },
        { state: 'value', text: 'One', ariaLabel: 'One' },
      ],
    });

    expect(registry.render(field, ['unknown-option'], { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Option unavailable',
      ariaLabel: 'Option unavailable',
    });
    expect(registry.render(field, ['unknown-option'], { translate }).chips).toBeUndefined();
  });

  it('renders chip state, deleted status, and accessible labels in structured DOM', () => {
    const translate = createTranslator('en');
    const field = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const element = createRenderedFieldValueElement(
      registry.render(field, ['option_old', 'option_1'], { translate }),
    );

    expect(element.dataset.valueState).toBe('value');
    expect(element.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe(
      'Old (Deleted option), One',
    );
    expect(
      [...element.querySelectorAll<HTMLElement>('[role="listitem"]')].map((chip) => ({
        text: chip.textContent,
        state: chip.dataset.chipState,
        ariaLabel: chip.getAttribute('aria-label'),
      })),
    ).toEqual([
      { text: 'Old (Deleted option)', state: 'deleted', ariaLabel: 'Old (Deleted option)' },
      { text: 'One', state: 'value', ariaLabel: 'One' },
    ]);
  });

  it('creates native Select and MultiSelect editors with retained deleted and safe unknown options', () => {
    const translate = createTranslator('en');
    const select = createField('select', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const selectEditor = createFieldEditor(select, 'option_old', { translate });

    expect(selectEditor.tagName).toBe('SELECT');
    expect((selectEditor as HTMLSelectElement).multiple).toBe(false);
    expect(
      [...selectEditor.querySelectorAll('option')].map((option) => option.textContent),
    ).toEqual(['Empty', 'One', 'Old (Deleted option)']);
    expect((selectEditor as HTMLSelectElement).value).toBe('option_old');
    expect(
      selectEditor.querySelector<HTMLOptionElement>('option[data-option-state="deleted"]')
        ?.disabled,
    ).toBe(false);

    const multiSelect = createField('multiSelect', select.config);
    const multiEditor = createFieldEditor(multiSelect, ['option_old', 'option_1'], { translate });
    const selectedValues = [...(multiEditor as HTMLSelectElement).selectedOptions].map(
      (option) => option.value,
    );

    expect(multiEditor.tagName).toBe('SELECT');
    expect((multiEditor as HTMLSelectElement).multiple).toBe(true);
    expect(multiEditor.getAttribute('aria-multiselectable')).toBe('true');
    expect(selectedValues).toEqual(['option_1', 'option_old']);
    expect(multiEditor.querySelectorAll('input')).toHaveLength(0);

    const unknownEditor = createFieldEditor(multiSelect, ['missing'], { translate });
    const unknownOption = unknownEditor.querySelector<HTMLOptionElement>(
      'option[data-option-state="unavailable"]',
    );
    expect(unknownOption?.textContent).toBe('Option unavailable');
    expect(unknownOption?.selected).toBe(true);
    expect(unknownOption?.textContent).not.toContain('missing');
  });

  it('publishes editing capability for the implemented Select and MultiSelect seam', () => {
    for (const type of [
      'text',
      'longText',
      'number',
      'checkbox',
      'date',
      'url',
      'select',
      'multiSelect',
      'location',
      'attachment',
    ] as const) {
      expect(registry.capability(createField(type)).renderer).toBe(type);
    }
    expect(registry.capability(createField('text')).editor).toEqual({
      kind: 'text',
      status: 'available',
    });
    expect(registry.capability(createField('select')).editor).toEqual({
      kind: 'select',
      status: 'available',
    });
    expect(registry.capability(createField('multiSelect')).editor).toEqual({
      kind: 'multiSelect',
      status: 'available',
    });
    expect(registry.capability(createField('location')).editor).toEqual({
      kind: 'none',
      status: 'unavailable',
    });
    expect(registry.capability(createField('attachment')).editor).toEqual({
      kind: 'none',
      status: 'unavailable',
    });
  });
});

function createField(type: Field['type'], config: Field['config'] = {}): Field {
  return {
    id: 'field_1',
    tableId: 'table_1',
    name: 'Field',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config,
  } as Field;
}

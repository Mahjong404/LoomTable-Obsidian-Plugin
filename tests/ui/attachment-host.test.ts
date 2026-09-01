import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LoomTableClient } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  createAttachmentOpenCallback,
  createAttachmentPreviewCallback,
  createBrowserAttachmentPreviewHost,
  isSafeAttachmentVaultPath,
  type AttachmentOpenHost,
  type AttachmentPreviewHost,
} from '../../src/ui/attachment-host';
import type { RenderedAttachment } from '../../src/ui/field-renderer-registry';

describe('Attachment open and preview host seams', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('opens only an explicit safe Vault path through the typed host', async () => {
    const openVaultFile = vi.fn();
    const host = { openVaultFile } satisfies AttachmentOpenHost;
    const callback = createAttachmentOpenCallback(host);

    await callback(
      'record_01',
      'field_attachment',
      attachment({
        source: 'vault',
        vaultPath: 'attachments/report.pdf',
      }),
    );

    expect(openVaultFile).toHaveBeenCalledWith('attachments/report.pdf');
  });

  it('does not open an unsafe or implicit Vault path', async () => {
    const openVaultFile = vi.fn();
    const callback = createAttachmentOpenCallback({ openVaultFile });

    await callback(
      'record_01',
      'field_attachment',
      attachment({
        source: 'vault',
        vaultPath: '../private/report.pdf',
      }),
    );
    await callback('record_01', 'field_attachment', attachment({ source: 'managed' }));

    expect(openVaultFile).not.toHaveBeenCalled();
    expect(isSafeAttachmentVaultPath('attachments/report.pdf')).toBe(true);
    expect(isSafeAttachmentVaultPath('../private/report.pdf')).toBe(false);
    expect(isSafeAttachmentVaultPath('C:/private/report.pdf')).toBe(false);
    expect(isSafeAttachmentVaultPath('/private/report.pdf')).toBe(false);
  });

  it('previews managed content with the response type and always revokes its URL', async () => {
    const client = {
      downloadAttachmentContent: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]).buffer,
        contentType: 'application/pdf',
      }),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = {
      createObjectUrl: vi.fn().mockReturnValue('blob:preview'),
      revokeObjectUrl: vi.fn(),
      showPreview: vi.fn().mockResolvedValue(undefined),
    } satisfies AttachmentPreviewHost;
    const callback = createAttachmentPreviewCallback(client, {
      host,
      translate: createTranslator('en'),
    });

    await callback(
      'record_grid',
      'field_attachment',
      attachment({
        filename: 'report.pdf',
        mimeType: 'application/octet-stream',
      }),
    );

    expect(client.downloadAttachmentContent).toHaveBeenCalledWith('attachment_1');
    expect(host.createObjectUrl).toHaveBeenCalledTimes(1);
    expect(host.createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(host.createObjectUrl.mock.calls[0]?.[0].type).toBe('application/pdf');
    expect(host.showPreview).toHaveBeenCalledWith(
      'blob:preview',
      'report.pdf',
      'application/pdf',
      expect.any(Function),
    );
    expect(host.revokeObjectUrl).toHaveBeenCalledWith('blob:preview');
  });

  it('does not request offline or non-managed content', async () => {
    const client = { downloadAttachmentContent: vi.fn() } as Pick<
      LoomTableClient,
      'downloadAttachmentContent'
    >;
    const host = {
      createObjectUrl: vi.fn(),
      revokeObjectUrl: vi.fn(),
      showPreview: vi.fn(),
    } satisfies AttachmentPreviewHost;
    const callback = createAttachmentPreviewCallback(client, {
      host,
      isOffline: () => true,
      translate: createTranslator('en'),
    });

    await callback('record_01', 'field_attachment', attachment());
    expect(client.downloadAttachmentContent).not.toHaveBeenCalled();
    expect(host.showPreview).not.toHaveBeenCalled();

    const onlineCallback = createAttachmentPreviewCallback(client, {
      host,
      isOffline: () => false,
      translate: createTranslator('en'),
    });
    await onlineCallback('record_01', 'field_attachment', attachment({ source: 'vault' }));
    expect(client.downloadAttachmentContent).not.toHaveBeenCalled();
  });

  it('revokes the URL when the preview surface fails', async () => {
    const client = {
      downloadAttachmentContent: vi.fn().mockResolvedValue({ bytes: new ArrayBuffer(0) }),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = {
      createObjectUrl: vi.fn().mockReturnValue('blob:preview'),
      revokeObjectUrl: vi.fn(),
      showPreview: vi.fn().mockRejectedValue(new Error('host failure')),
    } satisfies AttachmentPreviewHost;

    await expect(
      createAttachmentPreviewCallback(client, {
        host,
        translate: createTranslator('en'),
      })('record_01', 'field_attachment', attachment()),
    ).rejects.toThrow('host failure');
    expect(host.revokeObjectUrl).toHaveBeenCalledWith('blob:preview');
  });

  it('uses a labelled sandboxed preview surface and restores focus on close', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const host = createBrowserAttachmentPreviewHost(document);

    const preview = host.showPreview(
      'blob:preview',
      'report.pdf',
      'application/pdf',
      createTranslator('en'),
    );
    const surface = document.querySelector<HTMLElement>('.loom-attachment-preview-surface');
    const frame = surface?.querySelector<HTMLIFrameElement>('iframe');
    const close = surface?.querySelector<HTMLButtonElement>('.loom-attachment-preview-close');

    expect(surface?.getAttribute('role')).toBe('dialog');
    expect(surface?.getAttribute('aria-modal')).toBe('true');
    expect(surface?.textContent).toContain('Read-only attachment preview');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('title')).toContain('report.pdf');
    expect(document.activeElement).toBe(close);

    close?.click();
    await preview;
    expect(surface?.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});

function attachment(overrides: Partial<RenderedAttachment> = {}): RenderedAttachment {
  return {
    state: 'ready',
    id: 'attachment_1',
    filename: 'notes.md',
    source: 'managed',
    mimeType: 'text/markdown',
    statusText: 'Ready',
    metadataText: 'Managed',
    text: 'notes.md',
    ariaLabel: 'notes.md',
    ...overrides,
  };
}

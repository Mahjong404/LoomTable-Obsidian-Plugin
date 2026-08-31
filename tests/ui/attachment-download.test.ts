import { describe, expect, it, vi } from 'vitest';

import type { LoomTableClient } from '../../src/client/loomtable-client';
import {
  createAttachmentDownloadCallback,
  createBrowserAttachmentDownloadHost,
  downloadAttachment,
  type AttachmentDownloadHost,
} from '../../src/ui/attachment-download';
import type { RenderedAttachment } from '../../src/ui/field-renderer-registry';

describe('Attachment download host seam', () => {
  it('creates a Blob with the response type, sanitizes the filename, and revokes the object URL', async () => {
    const client = {
      downloadAttachmentContent: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]).buffer,
        contentType: 'text/plain',
      }),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = fakeHost();
    const attachment = renderedAttachment({
      filename: '../notes\\draft\u0000.md',
      mimeType: 'application/octet-stream',
    });

    await downloadAttachment(client, attachment, host, () => false);

    expect(client.downloadAttachmentContent).toHaveBeenCalledWith('attachment_1');
    expect(host.createObjectUrl).toHaveBeenCalledTimes(1);
    const blob = host.createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('text/plain');
    expect(host.triggerDownload).toHaveBeenCalledWith('blob:attachment', '.._notes_draft.md');
    expect(host.revokeObjectUrl).toHaveBeenCalledWith('blob:attachment');
  });

  it('uses a generic safe filename and revokes the object URL when triggering fails', async () => {
    const client = {
      downloadAttachmentContent: vi.fn().mockResolvedValue({ bytes: new ArrayBuffer(0) }),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = fakeHost();
    host.triggerDownload.mockImplementation(() => {
      throw new Error('host failure');
    });

    await expect(
      downloadAttachment(
        client,
        renderedAttachment({ filename: ' \u0001\u0002 ' }),
        host,
        () => false,
      ),
    ).rejects.toThrow('host failure');
    expect(host.triggerDownload).toHaveBeenCalledWith('blob:attachment', 'attachment');
    expect(host.revokeObjectUrl).toHaveBeenCalledWith('blob:attachment');
  });

  it('does not request uncached content while offline', async () => {
    const client = {
      downloadAttachmentContent: vi.fn(),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = fakeHost();

    await downloadAttachment(client, renderedAttachment(), host, () => true);

    expect(client.downloadAttachmentContent).not.toHaveBeenCalled();
    expect(host.createObjectUrl).not.toHaveBeenCalled();
    expect(host.triggerDownload).not.toHaveBeenCalled();
  });

  it('provides the same typed callback adapter for Grid and Map Detail hosts', async () => {
    const client = {
      downloadAttachmentContent: vi.fn().mockResolvedValue({ bytes: new ArrayBuffer(0) }),
    } as Pick<LoomTableClient, 'downloadAttachmentContent'>;
    const host = fakeHost();
    const callback = createAttachmentDownloadCallback(client, {
      host,
      isOffline: () => false,
    });
    const attachment = renderedAttachment();

    await callback('record_grid', 'field_attachment', attachment);
    await callback('record_map', 'field_attachment', attachment);

    expect(client.downloadAttachmentContent).toHaveBeenNthCalledWith(1, 'attachment_1');
    expect(client.downloadAttachmentContent).toHaveBeenNthCalledWith(2, 'attachment_1');
    expect(host.triggerDownload).toHaveBeenCalledTimes(2);
  });

  it('uses the browser host to trigger one anchor download and remove the anchor', () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:browser');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const host = createBrowserAttachmentDownloadHost(document);

    host.triggerDownload('blob:browser', 'notes.md');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement | undefined;
    if (anchor === undefined) throw new Error('The download anchor was not clicked.');
    expect(anchor.download).toBe('notes.md');
    expect(anchor.href).toContain('blob:browser');
    expect(document.body.querySelector('a[download="notes.md"]')).toBeNull();
    click.mockRestore();
  });
});

function fakeHost() {
  return {
    createObjectUrl: vi.fn((_blob: Blob) => 'blob:attachment'),
    revokeObjectUrl: vi.fn((_objectUrl: string) => undefined),
    triggerDownload: vi.fn((_objectUrl: string, _filename: string) => undefined),
  } satisfies AttachmentDownloadHost;
}

function renderedAttachment(overrides: Partial<RenderedAttachment> = {}): RenderedAttachment {
  return {
    state: 'ready',
    id: 'attachment_1',
    filename: 'notes.md',
    mimeType: 'text/markdown',
    statusText: 'Ready',
    metadataText: 'Type: text/markdown',
    text: 'notes.md',
    ariaLabel: 'notes.md, Ready',
    ...overrides,
  };
}

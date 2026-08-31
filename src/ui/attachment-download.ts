import type { LoomTableClient } from '../client/loomtable-client';
import type { RenderedAttachment } from './field-renderer-registry';

export interface AttachmentDownloadHost {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(objectUrl: string): void;
  triggerDownload(objectUrl: string, filename: string): void;
}

export type AttachmentDownloadCallback = (
  recordId: string,
  fieldId: string,
  attachment: RenderedAttachment,
) => void | Promise<void>;

export function createBrowserAttachmentDownloadHost(
  ownerDocument: Document = document,
): AttachmentDownloadHost {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
    triggerDownload: (objectUrl, filename) => {
      const anchor = ownerDocument.createElement('a');
      anchor.href = objectUrl;
      anchor.download = sanitizeAttachmentFilename(filename);
      anchor.setAttribute('aria-hidden', 'true');
      anchor.hidden = true;
      ownerDocument.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
  };
}

export async function downloadAttachment(
  client: Pick<LoomTableClient, 'downloadAttachmentContent'>,
  attachment: Pick<RenderedAttachment, 'id' | 'filename' | 'mimeType'>,
  host: AttachmentDownloadHost = createBrowserAttachmentDownloadHost(),
  isOffline: () => boolean = defaultIsOffline,
): Promise<void> {
  if (isOffline() || attachment.id === undefined) return;

  const downloaded = await client.downloadAttachmentContent(attachment.id);
  let objectUrl: string | null = null;
  try {
    const blob = new Blob([downloaded.bytes], {
      type: downloaded.contentType ?? attachment.mimeType ?? 'application/octet-stream',
    });
    objectUrl = host.createObjectUrl(blob);
    host.triggerDownload(objectUrl, sanitizeAttachmentFilename(attachment.filename));
  } finally {
    if (objectUrl !== null) host.revokeObjectUrl(objectUrl);
  }
}

export function createAttachmentDownloadCallback(
  client: Pick<LoomTableClient, 'downloadAttachmentContent'>,
  options: {
    readonly host?: AttachmentDownloadHost;
    readonly isOffline?: () => boolean;
  } = {},
): AttachmentDownloadCallback {
  const host = options.host ?? createBrowserAttachmentDownloadHost();
  const isOffline = options.isOffline ?? defaultIsOffline;
  return (_recordId, _fieldId, attachment) =>
    downloadAttachment(client, attachment, host, isOffline);
}

function sanitizeAttachmentFilename(filename: string | undefined): string {
  const safeFilename = Array.from(filename ?? '')
    .map((character) => (character === '/' || character === '\\' ? '_' : character))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
    })
    .join('')
    .trim();
  return safeFilename === '' ? 'attachment' : safeFilename;
}

function defaultIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}


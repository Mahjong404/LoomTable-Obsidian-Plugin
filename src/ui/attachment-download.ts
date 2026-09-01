import type { LoomTableClient } from '../client/loomtable-client';
import type { RenderedAttachment } from './field-renderer-registry';

export interface AttachmentDownloadHost {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(objectUrl: string): void;
  triggerDownload(objectUrl: string, filename: string): void;
}

export interface AttachmentVaultDownloadHost {
  downloadVaultFile(vaultPath: string, filename: string, mimeType?: string): void | Promise<void>;
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
  attachment: Pick<RenderedAttachment, 'id' | 'filename' | 'mimeType' | 'source'>,
  host: AttachmentDownloadHost = createBrowserAttachmentDownloadHost(),
  isOffline: () => boolean = defaultIsOffline,
): Promise<void> {
  if (isOffline() || attachment.source !== 'managed' || attachment.id === undefined) return;

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

export function isAttachmentDownloadable(
  attachment: Pick<RenderedAttachment, 'state' | 'id' | 'source' | 'vaultPath'>,
): boolean {
  return (
    attachment.state === 'ready' &&
    attachment.id !== undefined &&
    (attachment.source === 'managed' ||
      (attachment.source === 'vault' && isSafeAttachmentVaultPath(attachment.vaultPath)))
  );
}

async function downloadAttachmentBySource(
  client: Pick<LoomTableClient, 'downloadAttachmentContent'>,
  attachment: RenderedAttachment,
  host: AttachmentDownloadHost,
  vaultHost: AttachmentVaultDownloadHost | undefined,
  isOffline: () => boolean,
): Promise<void> {
  if (!isAttachmentDownloadable(attachment)) return;
  if (attachment.source === 'vault') {
    if (vaultHost === undefined || !isSafeAttachmentVaultPath(attachment.vaultPath)) return;
    await vaultHost.downloadVaultFile(
      attachment.vaultPath,
      sanitizeAttachmentFilename(attachment.filename),
      attachment.mimeType,
    );
    return;
  }
  if (isOffline()) return;
  await downloadAttachment(client, attachment, host, isOffline);
}

export interface AttachmentDownloadCallbackOptions {
  readonly host?: AttachmentDownloadHost;
  readonly vaultHost?: AttachmentVaultDownloadHost;
  readonly isOffline?: () => boolean;
}

export function createAttachmentDownloadCallback(
  client: Pick<LoomTableClient, 'downloadAttachmentContent'>,
  options: AttachmentDownloadCallbackOptions = {},
): AttachmentDownloadCallback {
  const host = options.host ?? createBrowserAttachmentDownloadHost();
  const isOffline = options.isOffline ?? defaultIsOffline;
  return (_recordId, _fieldId, attachment) =>
    downloadAttachmentBySource(client, attachment, host, options.vaultHost, isOffline);
}

export function isSafeAttachmentVaultPath(vaultPath: string | undefined): vaultPath is string {
  if (
    vaultPath === undefined ||
    vaultPath.trim() === '' ||
    vaultPath.startsWith('/') ||
    vaultPath.includes('\\') ||
    /^[A-Za-z]:/.test(vaultPath)
  ) {
    return false;
  }
  const segments = vaultPath.split('/');
  return (
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    !containsControlCharacter(vaultPath)
  );
}

export function sanitizeAttachmentFilename(filename: string | undefined): string {
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

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

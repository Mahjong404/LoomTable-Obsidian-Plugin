import type { App, TFile } from 'obsidian';

import type { LoomTableClient } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import {
  createBrowserAttachmentDownloadHost,
  isSafeAttachmentVaultPath,
  sanitizeAttachmentFilename,
  type AttachmentDownloadHost,
  type AttachmentVaultDownloadHost,
} from './attachment-download';
import type { RenderedAttachment } from './field-renderer-registry';

export { isSafeAttachmentVaultPath } from './attachment-download';

export interface AttachmentOpenHost {
  openVaultFile(vaultPath: string): void | Promise<void>;
}

export type AttachmentOpenCallback = (
  recordId: string,
  fieldId: string,
  attachment: RenderedAttachment,
) => void | Promise<void>;

export interface AttachmentPreviewHost {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(objectUrl: string): void;
  showPreview(
    objectUrl: string,
    filename: string,
    mimeType: string,
    translate: Translator,
  ): Promise<void>;
}

export type AttachmentPreviewCallback = (
  recordId: string,
  fieldId: string,
  attachment: RenderedAttachment,
) => void | Promise<void>;

export function createAttachmentOpenCallback(
  host: AttachmentOpenHost,
  isOffline: () => boolean = defaultIsOffline,
): AttachmentOpenCallback {
  return async (_recordId, _fieldId, attachment) => {
    if (
      isOffline() ||
      attachment.state !== 'ready' ||
      attachment.source !== 'vault' ||
      !isSafeAttachmentVaultPath(attachment.vaultPath)
    ) {
      return;
    }
    await host.openVaultFile(attachment.vaultPath);
  };
}

export interface AttachmentPreviewCallbackOptions {
  readonly host?: AttachmentPreviewHost;
  readonly isOffline?: () => boolean;
  readonly translate: Translator;
}

export function createAttachmentPreviewCallback(
  client: Pick<LoomTableClient, 'downloadAttachmentContent'>,
  options: AttachmentPreviewCallbackOptions,
): AttachmentPreviewCallback {
  const host = options.host ?? createBrowserAttachmentPreviewHost();
  const isOffline = options.isOffline ?? defaultIsOffline;

  return async (_recordId, _fieldId, attachment) => {
    if (
      isOffline() ||
      attachment.state !== 'ready' ||
      attachment.source !== 'managed' ||
      attachment.id === undefined
    ) {
      return;
    }

    const downloaded = await client.downloadAttachmentContent(attachment.id);
    let objectUrl: string | null = null;
    try {
      const blob = new Blob([downloaded.bytes], {
        type: downloaded.contentType ?? attachment.mimeType ?? 'application/octet-stream',
      });
      objectUrl = host.createObjectUrl(blob);
      await host.showPreview(
        objectUrl,
        sanitizeAttachmentFilename(attachment.filename),
        blob.type,
        options.translate,
      );
    } finally {
      if (objectUrl !== null) host.revokeObjectUrl(objectUrl);
    }
  };
}

export function createBrowserAttachmentPreviewHost(
  ownerDocument: Document = document,
): AttachmentPreviewHost {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
    showPreview: (objectUrl, filename, mimeType, translate) =>
      showBrowserAttachmentPreview(ownerDocument, objectUrl, filename, mimeType, translate),
  };
}

export function createObsidianAttachmentOpenHost(
  app: Pick<App, 'vault' | 'workspace'>,
): AttachmentOpenHost {
  return {
    openVaultFile: async (vaultPath) => {
      if (!isSafeAttachmentVaultPath(vaultPath)) return;
      const file = app.vault.getAbstractFileByPath(vaultPath);
      if (!isVaultFile(file, vaultPath)) {
        throw new Error('The requested Vault attachment is unavailable.');
      }
      await app.workspace.getLeaf(true).openFile(file);
    },
  };
}

export function createObsidianAttachmentDownloadHost(
  app: Pick<App, 'vault'>,
  downloadHost: AttachmentDownloadHost = createBrowserAttachmentDownloadHost(),
): AttachmentVaultDownloadHost {
  return {
    downloadVaultFile: async (vaultPath, filename, mimeType) => {
      if (!isSafeAttachmentVaultPath(vaultPath)) return;
      const file = app.vault.getAbstractFileByPath(vaultPath);
      if (!isVaultFile(file, vaultPath)) {
        throw new Error('The requested Vault attachment is unavailable.');
      }
      const bytes = await app.vault.readBinary(file);
      let objectUrl: string | null = null;
      try {
        const blob = new Blob([bytes], {
          type: mimeType ?? 'application/octet-stream',
        });
        objectUrl = downloadHost.createObjectUrl(blob);
        downloadHost.triggerDownload(objectUrl, sanitizeAttachmentFilename(filename));
      } finally {
        if (objectUrl !== null) downloadHost.revokeObjectUrl(objectUrl);
      }
    },
  };
}

function isVaultFile(value: unknown, vaultPath: string): value is TFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    readonly path?: unknown;
    readonly extension?: unknown;
    readonly stat?: unknown;
  };
  return (
    candidate.path === vaultPath &&
    typeof candidate.extension === 'string' &&
    typeof candidate.stat === 'object' &&
    candidate.stat !== null
  );
}

function showBrowserAttachmentPreview(
  ownerDocument: Document,
  objectUrl: string,
  filename: string,
  mimeType: string,
  translate: Translator,
): Promise<void> {
  return new Promise((resolve) => {
    const previousFocus =
      ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;
    const surface = ownerDocument.createElement('section');
    surface.className = 'loom-attachment-preview-surface';
    surface.setAttribute('role', 'dialog');
    surface.setAttribute('aria-modal', 'true');

    const title = ownerDocument.createElement('h2');
    title.className = 'loom-attachment-preview-title';
    title.id = nextPreviewId('title');
    title.textContent = `${translate('record.attachment.preview.title')}: ${filename}`;

    const description = ownerDocument.createElement('p');
    description.className = 'loom-attachment-preview-description';
    description.id = nextPreviewId('description');
    description.textContent = translate('record.attachment.preview.description');

    const close = ownerDocument.createElement('button');
    close.type = 'button';
    close.className = 'loom-button loom-attachment-preview-close';
    close.textContent = translate('record.attachment.preview.close');
    close.setAttribute('aria-label', translate('record.attachment.preview.close'));

    const frame = ownerDocument.createElement('iframe');
    frame.className = 'loom-attachment-preview-frame';
    frame.setAttribute('title', `${translate('record.attachment.preview.title')}: ${filename}`);
    frame.setAttribute('aria-describedby', description.id);
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'eager');
    frame.dataset.mimeType = mimeType;
    frame.src = objectUrl;

    surface.setAttribute('aria-labelledby', title.id);
    surface.setAttribute('aria-describedby', description.id);
    surface.append(title, description, close, frame);

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      surface.removeEventListener('keydown', onKeyDown);
      close.removeEventListener('click', finish);
      surface.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [close, frame];
      const index = focusable.indexOf(ownerDocument.activeElement as HTMLButtonElement);
      if (index === -1) {
        event.preventDefault();
        close.focus();
      } else if (event.shiftKey && index === 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };

    close.addEventListener('click', finish);
    surface.addEventListener('keydown', onKeyDown);
    ownerDocument.body.append(surface);
    close.focus();
  });
}

function nextPreviewId(suffix: string): string {
  previewId += 1;
  return `loom-attachment-preview-${suffix}-${previewId}`;
}

function defaultIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

let previewId = 0;

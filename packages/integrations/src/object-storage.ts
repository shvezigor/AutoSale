import type { Readable } from 'node:stream';

export type PutStreamInput = {
  key: string;
  body: Readable;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
};

export type StoredObjectStream = {
  body: Readable;
  contentType: string;
  contentLength: number;
};

export type StoredObjectHead = {
  contentLength: number;
  contentType: string;
  checksumSha256: string | null;
};

export interface ObjectStorage {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ key: string; etag: string }>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string }>;
  delete(key: string): Promise<void>;
  putStream?(input: PutStreamInput): Promise<{ key: string; etag: string }>;
  getStream?(key: string): Promise<StoredObjectStream>;
  head?(key: string): Promise<StoredObjectHead>;
  createSignedDownloadUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

export interface StreamingObjectStorage extends ObjectStorage {
  putStream(input: PutStreamInput): Promise<{ key: string; etag: string }>;
  getStream(key: string): Promise<StoredObjectStream>;
  head(key: string): Promise<StoredObjectHead>;
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}

// Used only by a privileged erasure workflow. The consumer may stop after a
// bounded batch, close the iterator, delete that batch, then restart the scan.
// Never delete while paginating an active iterator: provider cursors can move
// and skip objects. Repeat scan/delete until a full scan is empty.
export type TenantOwnedObjectVersion = {
  key: string;
  versionId: string | null;
  kind: 'object' | 'delete-marker';
  sizeBytes: number | null;
};

export interface TenantErasureObjectStorage {
  listTenantObjectVersions(tenantId: string): AsyncIterable<TenantOwnedObjectVersion>;
  deleteTenantObjectVersion(tenantId: string, object: TenantOwnedObjectVersion): Promise<void>;
}

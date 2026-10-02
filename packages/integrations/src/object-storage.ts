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

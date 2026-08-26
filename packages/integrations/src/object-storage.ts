export interface ObjectStorage {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ key: string; etag: string }>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string }>;
}

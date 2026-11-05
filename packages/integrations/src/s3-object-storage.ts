import { Readable } from 'node:stream';

import { CreateBucketCommand, DeleteObjectCommand, GetBucketVersioningCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, ListObjectVersionsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PutStreamInput, StoredObjectHead, StoredObjectStream, StreamingObjectStorage, TenantErasureObjectStorage, TenantOwnedObjectVersion } from './object-storage.js';

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_INVENTORY_PAGES_PER_PREFIX = 100_000;

function tenantObjectPrefixes(tenantId: string): readonly string[] {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw new Error('TENANT_OBJECT_ID_INVALID');
  return [`tenants/${tenantId}/`, `catalogue/${tenantId}/`, `tenant-lifecycle/${tenantId}/`];
}

function assertTenantObjectKey(prefix: string, key: string | undefined): asserts key is string {
  if (!key || !key.startsWith(prefix)) {
    throw new Error('TENANT_OBJECT_INVENTORY_SCOPE_INVALID');
  }
}

function isVersionedBucket(status: string | undefined): boolean {
  if (status === undefined) return false;
  if (status === 'Enabled' || status === 'Suspended') return true;
  throw new Error('TENANT_OBJECT_VERSIONING_UNKNOWN');
}

export interface S3ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

type S3ObjectStorageDependencies = {
  client?: S3Client;
  sign?: typeof getSignedUrl;
};

export class S3ObjectStorage implements StreamingObjectStorage, TenantErasureObjectStorage {
  private readonly client: S3Client;
  private readonly sign: typeof getSignedUrl;

  constructor(private readonly config: S3ObjectStorageConfig, dependencies: S3ObjectStorageDependencies = {}) {
    this.client = dependencies.client ?? new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.sign = dependencies.sign ?? getSignedUrl;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
      }
    }
  }

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ key: string; etag: string }> {
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    if (!response.ETag) {
      throw new Error('Object storage did not return an ETag');
    }

    return { key: input.key, etag: response.ETag.replaceAll('"', '') };
  }

  async get(key: string): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body || !response.ContentType) {
      throw new Error('Stored object is missing its body or content type');
    }
    return {
      body: await response.Body.transformToByteArray(),
      contentType: response.ContentType,
    };
  }

  async putStream(input: PutStreamInput): Promise<{ key: string; etag: string }> {
    if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
      throw new Error('OBJECT_CONTENT_LENGTH_INVALID');
    }
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      ChecksumSHA256: input.checksumSha256,
    }));
    if (!response.ETag) throw new Error('Object storage did not return an ETag');
    return { key: input.key, etag: response.ETag.replaceAll('"', '') };
  }

  async getStream(key: string): Promise<StoredObjectStream> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!(response.Body instanceof Readable)
      || !response.ContentType
      || typeof response.ContentLength !== 'number') {
      throw new Error('STORED_OBJECT_STREAM_METADATA_MISSING');
    }
    return {
      body: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  async head(key: string): Promise<StoredObjectHead> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ChecksumMode: 'ENABLED',
    }));
    if (!response.ContentType || typeof response.ContentLength !== 'number') {
      throw new Error('STORED_OBJECT_METADATA_MISSING');
    }
    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      checksumSha256: response.ChecksumSHA256 ?? null,
    };
  }

  async createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 600) {
      throw new Error('SIGNED_URL_EXPIRY_INVALID');
    }
    return this.sign(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async *listTenantObjectVersions(tenantId: string): AsyncIterable<TenantOwnedObjectVersion> {
    const prefixes = tenantObjectPrefixes(tenantId);
    const versioning = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.config.bucket }));
    const versioned = isVersionedBucket(versioning.Status);

    for (const prefix of prefixes) {
      if (versioned) {
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;
        const seenCursors = new Set<string>();
        do {
          if (seenCursors.size >= MAX_INVENTORY_PAGES_PER_PREFIX) throw new Error('TENANT_OBJECT_INVENTORY_PAGE_LIMIT');
          const page = await this.client.send(new ListObjectVersionsCommand({
            Bucket: this.config.bucket,
            Prefix: prefix,
            MaxKeys: 1_000,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }));
          for (const version of page.Versions ?? []) {
            assertTenantObjectKey(prefix, version.Key);
            if (!version.VersionId) throw new Error('TENANT_OBJECT_VERSION_ID_MISSING');
            yield {
              key: version.Key,
              versionId: version.VersionId,
              kind: 'object',
              sizeBytes: version.Size ?? null,
            };
          }
          for (const marker of page.DeleteMarkers ?? []) {
            assertTenantObjectKey(prefix, marker.Key);
            if (!marker.VersionId) throw new Error('TENANT_OBJECT_VERSION_ID_MISSING');
            yield {
              key: marker.Key,
              versionId: marker.VersionId,
              kind: 'delete-marker',
              sizeBytes: null,
            };
          }
          if (page.IsTruncated === false) break;
          if (page.IsTruncated !== true) throw new Error('TENANT_OBJECT_INVENTORY_PAGE_INVALID');
          const nextCursor = JSON.stringify([page.NextKeyMarker, page.NextVersionIdMarker]);
          if (!page.NextKeyMarker || seenCursors.has(nextCursor)) {
            throw new Error('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
          }
          assertTenantObjectKey(prefix, page.NextKeyMarker);
          seenCursors.add(nextCursor);
          keyMarker = page.NextKeyMarker;
          versionIdMarker = page.NextVersionIdMarker;
        } while (true);
      } else {
        let continuationToken: string | undefined;
        const seenCursors = new Set<string>();
        do {
          if (seenCursors.size >= MAX_INVENTORY_PAGES_PER_PREFIX) throw new Error('TENANT_OBJECT_INVENTORY_PAGE_LIMIT');
          const page = await this.client.send(new ListObjectsV2Command({
            Bucket: this.config.bucket,
            Prefix: prefix,
            MaxKeys: 1_000,
            ContinuationToken: continuationToken,
          }));
          for (const object of page.Contents ?? []) {
            assertTenantObjectKey(prefix, object.Key);
            yield { key: object.Key, versionId: null, kind: 'object', sizeBytes: object.Size ?? null };
          }
          if (page.IsTruncated === false) break;
          if (page.IsTruncated !== true) throw new Error('TENANT_OBJECT_INVENTORY_PAGE_INVALID');
          if (!page.NextContinuationToken || seenCursors.has(page.NextContinuationToken)) {
            throw new Error('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
          }
          seenCursors.add(page.NextContinuationToken);
          continuationToken = page.NextContinuationToken;
        } while (true);
      }
    }
  }

  async deleteTenantObjectVersion(tenantId: string, object: TenantOwnedObjectVersion): Promise<void> {
    const prefixes = tenantObjectPrefixes(tenantId);
    if (!prefixes.some((prefix) => object.key.startsWith(prefix))) {
      throw new Error('TENANT_OBJECT_INVENTORY_SCOPE_INVALID');
    }
    if (object.kind !== 'object' && object.kind !== 'delete-marker') {
      throw new Error('TENANT_OBJECT_INVENTORY_KIND_INVALID');
    }
    if (object.versionId === null) {
      if (object.kind !== 'object') throw new Error('TENANT_OBJECT_VERSION_ID_MISSING');
      const versioning = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.config.bucket }));
      if (isVersionedBucket(versioning.Status)) {
        throw new Error('TENANT_OBJECT_VERSIONING_CHANGED');
      }
    } else if (!object.versionId) {
      throw new Error('TENANT_OBJECT_VERSION_ID_MISSING');
    }
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: object.key,
        ...(object.versionId === null ? {} : { VersionId: object.versionId }),
      }));
    } catch (error) {
      // A replay can retry a version that was already removed. Only the two
      // explicit object-not-found codes are idempotent; authorization, bucket
      // and transport failures must remain visible to the orchestrator.
      const name = error instanceof Error ? error.name : '';
      if (name !== 'NoSuchVersion' && name !== 'NoSuchKey') throw error;
    }
  }
}

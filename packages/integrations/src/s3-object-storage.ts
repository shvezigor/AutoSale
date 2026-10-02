import { Readable } from 'node:stream';

import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PutStreamInput, StoredObjectHead, StoredObjectStream, StreamingObjectStorage } from './object-storage.js';

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

export class S3ObjectStorage implements StreamingObjectStorage {
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
    const response = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
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
}

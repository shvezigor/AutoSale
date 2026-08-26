import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ObjectStorage } from './object-storage.js';

export interface S3ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3ObjectStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
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
}

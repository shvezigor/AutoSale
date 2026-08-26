import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  MalformedSupportedEventError,
  normalizeInstagramEvent,
} from './instagram-normalizer.js';

async function fixture(name: string): Promise<unknown> {
  const content = await readFile(
    resolve(process.cwd(), `../../tests/fixtures/meta/${name}`),
    'utf8',
  );
  return JSON.parse(content) as unknown;
}

describe('normalizeInstagramEvent', () => {
  let textFixture: unknown;
  let imageFixture: unknown;

  beforeAll(async () => {
    [textFixture, imageFixture] = await Promise.all([
      fixture('text-message.json'),
      fixture('image-message.json'),
    ]);
  });

  it('normalizes an inbound text message', () => {
    expect(normalizeInstagramEvent(textFixture)).toEqual([
      expect.objectContaining({
        externalMessageId: 'm_text_001',
        externalConversationId: 'ig-user-100',
        senderId: 'ig-user-100',
        direction: 'INBOUND',
        text: 'Хочу чорну модель 38 розміру',
        attachments: [],
      }),
    ]);
  });

  it('normalizes an image without inventing text', () => {
    expect(normalizeInstagramEvent(imageFixture)).toEqual([
      expect.objectContaining({
        externalMessageId: 'm_image_001',
        text: null,
        attachments: [
          {
            type: 'IMAGE',
            sourceUrl: 'https://lookaside.example.test/instagram/image-001.jpg',
          },
        ],
      }),
    ]);
  });

  it('ignores unsupported delivery events', () => {
    expect(
      normalizeInstagramEvent({
        object: 'instagram',
        entry: [{ messaging: [{ delivery: { mids: ['m_1'] } }] }],
      }),
    ).toEqual([]);
  });

  it('rejects a supported message without a stable identity', () => {
    expect(() =>
      normalizeInstagramEvent({
        object: 'instagram',
        entry: [{ messaging: [{ sender: { id: 'ig-user-100' }, message: { text: 'hello' } }] }],
      }),
    ).toThrow(MalformedSupportedEventError);
  });
});

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
            sourceUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          },
        ],
      }),
    ]);
  });

  it('keeps shared Instagram posts, reels, stories, and unknown attachments visible', () => {
    const payload = {
      object: 'instagram',
      entry: [{
        messaging: [{
          sender: { id: 'ig-user-200' },
          recipient: { id: 'ig-business' },
          timestamp: 1787731202123,
          message: {
            mid: 'm_shared_content_001',
            attachments: [
              { type: 'ig_post', payload: { url: 'https://lookaside.example/post.jpg', title: 'Post' } },
              { type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/fictional', title: 'Reel' } },
              { type: 'ig_story', payload: { story_media_url: 'https://lookaside.example/story.jpg' } },
              { type: 'template', payload: { generic: { elements: [] } } },
            ],
          },
        }],
      }],
    };

    expect(normalizeInstagramEvent(payload)[0]?.attachments).toEqual([
      { type: 'IMAGE', sourceUrl: 'https://lookaside.example/post.jpg' },
      { type: 'LINK', sourceUrl: 'https://www.instagram.com/reel/fictional' },
      { type: 'LINK', sourceUrl: 'https://lookaside.example/story.jpg' },
      { type: 'UNSUPPORTED', sourceUrl: 'instagram:template' },
    ]);
  });

  it('does not expose unsafe attachment URLs as clickable links', () => {
    const payload = {
      object: 'instagram',
      entry: [{
        messaging: [{
          sender: { id: 'ig-user-201' },
          recipient: { id: 'ig-business' },
          timestamp: 1787731203123,
          message: {
            mid: 'm_unsafe_share_001',
            attachments: [{ type: 'share', payload: { url: 'javascript:alert(1)' } }],
          },
        }],
      }],
    };

    expect(normalizeInstagramEvent(payload)[0]?.attachments).toEqual([
      { type: 'UNSUPPORTED', sourceUrl: 'instagram:share' },
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

  it('rejects a persisted payload that is not an Instagram callback', () => {
    expect(() => normalizeInstagramEvent({ object: 'page', entry: [] })).toThrow(
      MalformedSupportedEventError,
    );
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

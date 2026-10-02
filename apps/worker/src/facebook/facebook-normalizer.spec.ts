import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MalformedSupportedEventError } from '../social/normalized-inbound-message.js';
import { normalizeFacebookEvent } from './facebook-normalizer.js';

describe('normalizeFacebookEvent', () => {
  it('normalizes a Page text message', async () => {
    const messages = normalizeFacebookEvent(await fixture('facebook-text-message.json'));

    expect(messages).toEqual([expect.objectContaining({
      channel: 'FACEBOOK',
      externalMessageId: 'mid.facebook.text.001',
      externalConversationId: 'fictional-psid-100',
      participantId: 'fictional-psid-100',
      senderId: 'fictional-psid-100',
      direction: 'INBOUND',
      text: 'Хочу замовити один тестовий товар',
      attachments: [],
    })]);
  });

  it('normalizes image, video, link and unsupported attachments', () => {
    const messages = normalizeFacebookEvent(pagePayload({
      mid: 'mid.facebook.media.001',
      attachments: [
        { type: 'image', payload: { url: 'https://cdn.example.test/image.jpg' } },
        { type: 'video', payload: { url: 'https://cdn.example.test/video.mp4' } },
        { type: 'fallback', payload: { url: 'https://example.test/product' } },
        { type: 'audio', payload: { url: 'https://cdn.example.test/audio.m4a' } },
      ],
    }));

    expect(messages[0]?.attachments).toEqual([
      { type: 'IMAGE', sourceUrl: 'https://cdn.example.test/image.jpg' },
      { type: 'VIDEO', sourceUrl: 'https://cdn.example.test/video.mp4' },
      { type: 'LINK', sourceUrl: 'https://example.test/product' },
      { type: 'UNSUPPORTED', sourceUrl: 'facebook:audio' },
    ]);
  });

  it('ignores Page echo and non-message events', () => {
    const payload = pagePayload({ mid: 'mid.facebook.echo.001', is_echo: true });
    const entry = (payload.entry as Array<Record<string, unknown>>)[0]!;
    (entry.messaging as unknown[]).push({ sender: { id: 'user' }, read: { watermark: 1 } });

    expect(normalizeFacebookEvent(payload)).toEqual([]);
  });

  it('rejects malformed supported messages without exposing payload data', () => {
    const payload = pagePayload({ text: 'secret', mid: undefined });

    expect(() => normalizeFacebookEvent(payload)).toThrow(MalformedSupportedEventError);
    expect(() => normalizeFacebookEvent(payload)).toThrow('Supported message requires message.mid');
  });
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), `../../tests/fixtures/meta/${name}`), 'utf8'));
}

function pagePayload(message: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'page',
    entry: [{
      id: 'facebook-page-200',
      messaging: [{
        sender: { id: 'facebook-user-100' },
        recipient: { id: 'facebook-page-200' },
        timestamp: 1_797_696_000_000,
        message,
      }],
    }],
  };
}

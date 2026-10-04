import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MalformedSupportedEventError } from '../social/normalized-inbound-message.js';
import { decodeTikTokMediaSource, normalizeTikTokEvent } from './tiktok-normalizer.js';

describe('normalizeTikTokEvent', () => {
  it('normalizes inbound text without exposing provider envelope details', async () => {
    const messages = normalizeTikTokEvent(await fixture('text-message.json'));

    expect(messages).toEqual([expect.objectContaining({
      channel: 'TIKTOK',
      externalMessageId: 'fictional-message-text-001',
      externalConversationId: 'fictional-conversation-001',
      participantId: 'fictional-customer-id',
      direction: 'INBOUND',
      text: 'Хочу замовити Fictional Product',
      attachments: [],
    })]);
  });

  it.each([
    ['image-message.json', 'IMAGE', 'fictional-image-media-id'],
    ['video-message.json', 'VIDEO', 'fictional-video-media-id'],
  ] as const)('normalizes authenticated %s media references', async (name, type, mediaId) => {
    const [message] = normalizeTikTokEvent(await fixture(name));
    expect(message?.attachments).toHaveLength(1);
    const attachment = message!.attachments[0]!;
    expect(attachment.type).toBe(type);
    expect(decodeTikTokMediaSource(attachment.sourceUrl)).toEqual({
      accountId: 'fictional-business-account',
      conversationId: 'fictional-conversation-001',
      messageId: expect.stringContaining('fictional-message-'),
      mediaId,
      mediaType: type,
    });
  });

  it('normalizes shared posts as links', async () => {
    expect(normalizeTikTokEvent(await fixture('link-message.json'))[0]?.attachments).toEqual([{
      type: 'LINK',
      sourceUrl: 'https://www.tiktok.com/@fictional/video/7000000000000000000',
    }]);
  });

  it('ignores outbound echoes so they cannot trigger inbound order recognition', async () => {
    const payload = await fixture('text-message.json');
    payload.event = 'im_send_msg';
    expect(normalizeTikTokEvent(payload)).toEqual([]);
  });

  it('preserves mixed text and media content', async () => {
    const payload = await fixture('image-message.json');
    const content = JSON.parse(payload.content as string) as Record<string, unknown>;
    content.text = { body: 'Ось фото' };
    payload.content = JSON.stringify(content);
    const [message] = normalizeTikTokEvent(payload);
    expect(message).toMatchObject({ text: 'Ось фото', attachments: [{ type: 'IMAGE' }] });
  });

  it('rejects malformed supported media and contains unsupported content safely', async () => {
    const malformed = await fixture('image-message.json');
    const malformedContent = JSON.parse(malformed.content as string) as Record<string, unknown>;
    malformedContent.image = {};
    malformed.content = JSON.stringify(malformedContent);
    expect(() => normalizeTikTokEvent(malformed)).toThrow(MalformedSupportedEventError);

    const unsupported = await fixture('text-message.json');
    const content = JSON.parse(unsupported.content as string) as Record<string, unknown>;
    content.type = 'sticker';
    delete content.text;
    unsupported.content = JSON.stringify(content);
    expect(normalizeTikTokEvent(unsupported)[0]?.attachments).toEqual([{
      type: 'UNSUPPORTED', sourceUrl: 'tiktok:sticker',
    }]);
  });
});

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(process.cwd(), `../../tests/fixtures/tiktok/${name}`), 'utf8')) as Record<string, unknown>;
}

'use client';

import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';
import { useI18n } from '../i18n/i18n-provider';

export function MessageThread({
  conversation,
  onRetry,
  retryingMessageId,
}: {
  conversation: ConversationDetailResponse;
  onRetry?: (messageId: string) => void;
  retryingMessageId?: string | null;
}) {
  const { formatDate, t } = useI18n();
  return (
    <ol className="message-thread" aria-label={t('conversations.messageHistory')}>
      {conversation.messages.map((message) => (
        <li className="message-row" data-direction={message.direction} key={message.id}>
          <article className="message-bubble">
            <span className="sr-only">{message.direction === 'INBOUND' ? t('conversations.incoming') : t('conversations.outgoing')}</span>
            {message.text ? <p>{messageText(message.text)}</p> : null}
            {message.attachments.map((attachment) => {
              if (attachment.type === 'LINK' && attachment.mediaUrl) {
                return (
                  <a
                    className="message-attachment-link"
                    href={attachment.mediaUrl}
                    key={attachment.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t('conversations.openInstagramContent')}
                  </a>
                );
              }
              if (attachment.type === 'UNSUPPORTED') {
                return <div className="attachment-placeholder" key={attachment.id}>{t('conversations.unsupportedInstagramAttachment')}</div>;
              }
              return attachment.copyStatus === 'COPIED' && attachment.mediaUrl ? (
                // The API URL is controlled by Sales AITO and never exposes provider or S3 credentials.
                <img
                  alt={t('conversations.instagramAttachment')}
                  className="message-media"
                  height="220"
                  key={attachment.id}
                  loading="lazy"
                  src={attachment.mediaUrl}
                  width="280"
                />
              ) : (
                <div className="attachment-failure" key={attachment.id} role="status">
                  {t('conversations.attachmentFailed')}
                </div>
              );
            })}
            <footer className="message-meta">
              {message.delivery ? (
                <span className={`delivery-status delivery-${message.delivery.status.toLowerCase()}`} aria-live="polite">
                  {deliveryLabel(message.delivery.status, message.delivery.errorCode, t)}
                </span>
              ) : null}
              <time dateTime={message.sourceTimestamp}>{formatDate(message.sourceTimestamp, { hour: '2-digit', minute: '2-digit' })}</time>
            </footer>
            {message.delivery?.status === 'FAILED' && message.delivery.retryAllowed && onRetry ? (
              <button
                className="message-retry"
                disabled={retryingMessageId === message.id}
                onClick={() => onRetry(message.id)}
                type="button"
              >
                {retryingMessageId === message.id ? t('conversations.retrying') : t('conversations.retrySending')}
              </button>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}

const httpUrlPattern = /https?:\/\/[^\s<>"']+/gi;
const trailingPunctuationPattern = /[.,!?;:]+$/;

function messageText(text: string) {
  const content: Array<string | React.ReactElement> = [];
  let cursor = 0;

  for (const match of text.matchAll(httpUrlPattern)) {
    const rawUrl = match[0];
    const index = match.index;
    const trailing = rawUrl.match(trailingPunctuationPattern)?.[0] ?? '';
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;

    if (index > cursor) content.push(text.slice(cursor, index));
    content.push(
      <a className="message-text-link" href={url} key={`${index}:${url}`} rel="noopener noreferrer" target="_blank">
        {url}
      </a>,
    );
    if (trailing) content.push(trailing);
    cursor = index + rawUrl.length;
  }

  if (cursor < text.length) content.push(text.slice(cursor));
  return content.length > 0 ? content : text;
}

function deliveryLabel(
  status: NonNullable<ConversationDetailResponse['messages'][number]['delivery']>['status'],
  errorCode: NonNullable<ConversationDetailResponse['messages'][number]['delivery']>['errorCode'],
  t: ReturnType<typeof useI18n>['t'],
) {
  if (status === 'PENDING' || status === 'SENDING') return t('conversations.sending');
  if (status === 'SENT') return t('conversations.sent');
  if (status === 'UNKNOWN') return t('conversations.deliveryUnknown');
  if (errorCode === 'INSTAGRAM_RECONNECT_REQUIRED') return t('conversations.reconnectRequired');
  if (errorCode === 'INSTAGRAM_RATE_LIMITED') return t('conversations.rateLimited');
  return t('conversations.sendFailed');
}

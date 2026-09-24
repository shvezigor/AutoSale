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
            {message.text ? <p>{message.text}</p> : null}
            {message.attachments.map((attachment) =>
              attachment.copyStatus === 'COPIED' ? (
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
              ),
            )}
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

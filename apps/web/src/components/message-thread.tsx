import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';

export function MessageThread({
  conversation,
  onRetry,
  retryingMessageId,
}: {
  conversation: ConversationDetailResponse;
  onRetry?: (messageId: string) => void;
  retryingMessageId?: string | null;
}) {
  return (
    <ol className="message-thread" aria-label="Історія повідомлень">
      {conversation.messages.map((message) => (
        <li className="message-row" data-direction={message.direction} key={message.id}>
          <article className="message-bubble">
            <span className="sr-only">{message.direction === 'INBOUND' ? 'Вхідне' : 'Вихідне'}</span>
            {message.text ? <p>{message.text}</p> : null}
            {message.attachments.map((attachment) =>
              attachment.copyStatus === 'COPIED' ? (
                // The API URL is controlled by AutoSale and never exposes provider or S3 credentials.
                <img
                  alt="Вкладення з Instagram"
                  className="message-media"
                  height="220"
                  key={attachment.id}
                  loading="lazy"
                  src={attachment.mediaUrl}
                  width="280"
                />
              ) : (
                <div className="attachment-failure" key={attachment.id} role="status">
                  Не вдалося завантажити вкладення
                </div>
              ),
            )}
            <footer className="message-meta">
              {message.delivery ? (
                <span className={`delivery-status delivery-${message.delivery.status.toLowerCase()}`} aria-live="polite">
                  {deliveryLabel(message.delivery.status, message.delivery.errorCode)}
                </span>
              ) : null}
              <time dateTime={message.sourceTimestamp}>{formatMessageTime(message.sourceTimestamp)}</time>
            </footer>
            {message.delivery?.status === 'FAILED' && message.delivery.retryAllowed && onRetry ? (
              <button
                className="message-retry"
                disabled={retryingMessageId === message.id}
                onClick={() => onRetry(message.id)}
                type="button"
              >
                {retryingMessageId === message.id ? 'Повторюємо…' : 'Повторити надсилання'}
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
) {
  if (status === 'PENDING' || status === 'SENDING') return 'Надсилається…';
  if (status === 'SENT') return 'Надіслано';
  if (status === 'UNKNOWN') return 'Статус доставки невідомий';
  if (errorCode === 'INSTAGRAM_RECONNECT_REQUIRED') return 'Потрібно перепідключити Instagram';
  if (errorCode === 'INSTAGRAM_RATE_LIMITED') return 'Instagram тимчасово обмежив надсилання';
  return 'Не вдалося надіслати';
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value));
}

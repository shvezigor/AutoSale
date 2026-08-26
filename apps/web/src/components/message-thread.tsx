import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';

export function MessageThread({ conversation }: { conversation: ConversationDetailResponse }) {
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
            <time dateTime={message.sourceTimestamp}>{formatMessageTime(message.sourceTimestamp)}</time>
          </article>
        </li>
      ))}
    </ol>
  );
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value));
}

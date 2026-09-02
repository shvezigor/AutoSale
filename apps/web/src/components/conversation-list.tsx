import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';

interface ConversationListProps {
  conversations: ConversationListResponse['items'];
  selectedId?: string | undefined;
}

export function ConversationList({ conversations, selectedId }: ConversationListProps) {
  if (conversations.length === 0) {
    return <p className="empty-list">Діалогів поки немає</p>;
  }

  return (
    <nav aria-label="Список діалогів" className="conversation-list">
      {conversations.map((conversation) => {
        const name = conversation.participantName ??
          (conversation.participantUsername ? `@${conversation.participantUsername}` : 'Клієнт Instagram');
        return (
          <Link
            className="conversation-row"
            data-selected={conversation.id === selectedId}
            href={`/conversations/${conversation.id}`}
            key={conversation.id}
          >
            {conversation.participantAvatarUrl
              ? <img className="avatar" src={conversation.participantAvatarUrl} alt={`Фото профілю ${name}`} />
              : <span className="avatar" aria-hidden="true">{initials(name)}</span>}
            <span className="conversation-copy">
              <span className="conversation-line">
                <strong>{name}</strong>
                <time dateTime={conversation.lastMessageAt}>{formatListTime(conversation.lastMessageAt)}</time>
              </span>
              <span className="conversation-preview">
                {conversation.lastMessagePreview ?? 'Вкладення з Instagram'}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatListTime(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value));
}

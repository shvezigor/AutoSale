'use client';

import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { useI18n } from '../i18n/i18n-provider';

interface ConversationListProps {
  conversations: ConversationListResponse['items'];
  selectedId?: string | undefined;
}
export function ConversationList({ conversations, selectedId }: ConversationListProps) {
  const { formatDate, t } = useI18n();
  if (conversations.length === 0) {
    return <p className="empty-list">{t('conversations.emptyList')}</p>;
  }

  return (
    <nav aria-label={t('conversations.listLabel')} className="conversation-list">
      {conversations.map((conversation) => {
        const name = conversation.participantName ??
          (conversation.participantUsername ? `@${conversation.participantUsername}` : t('conversations.instagramCustomer'));
        return (
          <Link
            className="conversation-row"
            data-selected={conversation.id === selectedId}
            href={`/conversations/${conversation.id}`}
            key={conversation.id}
          >
            {conversation.participantAvatarUrl
              ? <img className="avatar" src={conversation.participantAvatarUrl} alt={t('conversations.profilePhoto', { name })} />
              : <span className="avatar" aria-hidden="true">{initials(name)}</span>}
            <span className="conversation-copy">
              <span className="conversation-line">
                <strong>{name}</strong>
                <time dateTime={conversation.lastMessageAt}>{formatDate(conversation.lastMessageAt, { hour: '2-digit', minute: '2-digit' })}</time>
              </span>
              <span className="conversation-preview">
                {conversation.lastMessagePreview ?? t('conversations.instagramAttachment')}
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

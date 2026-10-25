'use client';

import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { ConversationStatusMenu } from './conversation-status-menu';
import { useI18n } from '../i18n/i18n-provider';

interface ConversationListProps {
  conversations: ConversationListResponse['items'];
  status?: string;
  selectedId?: string | undefined;
}
export function ConversationList({ conversations, selectedId, status }: ConversationListProps) {
  const { formatDate, t } = useI18n();
  if (conversations.length === 0) {
    return <p className="empty-list">{t('conversations.emptyList')}</p>;
  }

  return (
    <nav aria-label={t('conversations.listLabel')} className="conversation-list">
      {conversations.map((conversation) => {
        const channelLabel = conversation.channel === 'FACEBOOK'
          ? t('conversations.channelFacebook')
          : conversation.channel === 'TIKTOK'
            ? t('conversations.channelTikTok')
            : t('conversations.channelInstagram');
        const name = conversation.participantName ??
          (conversation.participantUsername
            ? `@${conversation.participantUsername}`
            : conversation.channel === 'FACEBOOK'
              ? t('conversations.facebookCustomer')
              : conversation.channel === 'TIKTOK'
                ? t('conversations.tiktokCustomer')
                : t('conversations.instagramCustomer'));
        return (
          <div className="conversation-row-actions" key={conversation.id}>
            <Link
              className="conversation-row"
              data-selected={conversation.id === selectedId}
              href={`/conversations/${conversation.id}${status ? `?status=${status.toLowerCase()}` : ""}`}
            >
              {conversation.participantAvatarUrl
                ? <img className="avatar" src={conversation.participantAvatarUrl} alt={t('conversations.profilePhoto', { name })} />
                : <span className="avatar" aria-hidden="true">{initials(name)}</span>}
              <span className="conversation-copy">
                <span className="conversation-line">
                  <strong>{name} <span className="conversation-channel-badge">{channelLabel}</span></strong>
                  <time dateTime={conversation.lastMessageAt}>{formatDate(conversation.lastMessageAt, { hour: '2-digit', minute: '2-digit' })}</time>
                </span>
                <span className="conversation-preview">
                  {conversation.lastMessagePreview ?? t('conversations.instagramAttachment')}
                </span>
              </span>
            </Link>
            <ConversationStatusMenu id={conversation.id} name={name} workflowStatus={conversation.workflowStatus} statusVersion={conversation.statusVersion} />
          </div>
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

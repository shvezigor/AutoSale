import { getConversation, getConversationOrder } from '../../../../src/api/conversations';
import { getServerSession } from '../../../../src/auth/session';
import { InstagramReplyComposer } from '../../../../src/components/instagram-reply-composer';
import { ConversationOrderPanel } from '../../../../src/components/conversation-order-panel';
import { MessageThread } from '../../../../src/components/message-thread';
import { createTranslator } from '../../../../src/i18n/translator';

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conversation, orderState, session] = await Promise.all([
    getConversation(id), getConversationOrder(id), getServerSession(),
  ]);
  const t = createTranslator(session?.locale ?? 'uk');
  const name = conversation.participantName ??
    (conversation.participantUsername
      ? `@${conversation.participantUsername}`
      : conversation.channel === 'FACEBOOK'
        ? t('conversations.facebookCustomer')
        : conversation.channel === 'TIKTOK'
          ? t('conversations.tiktokCustomer')
          : t('conversations.instagramCustomer'));
  const channelLabel = conversation.channel === 'FACEBOOK'
    ? t('conversations.channelFacebook')
    : conversation.channel === 'TIKTOK'
      ? t('conversations.channelTikTok')
      : t('conversations.channelInstagram');
  const accountLabel = conversation.participantName && conversation.participantUsername
    ? `@${conversation.participantUsername} · ${channelLabel}`
    : channelLabel;

  return (
    <div className="conversation-detail-transition" key={id}>
      <section className="conversation-panel">
        <header className="conversation-header">
          {conversation.participantAvatarUrl
            ? <img className="avatar large" src={conversation.participantAvatarUrl} alt={t('conversations.profilePhoto', { name })} />
            : <span className="avatar large" aria-hidden="true">{name[0]}</span>}
          <span><h2>{name}</h2><small>{accountLabel}</small></span>
        </header>
        {conversation.channel === 'INSTAGRAM' ? (
          <InstagramReplyComposer
            canManageSettings={session?.membershipRole === 'OWNER'}
            initialConversation={conversation}
            key={conversation.id}
          />
        ) : (
          <>
            <div className="thread-scroll"><MessageThread conversation={conversation} /></div>
            <p className="reply-area">{conversation.channel === 'TIKTOK' ? t('conversations.tiktokReadOnly') : t('conversations.facebookReadOnly')}</p>
          </>
        )}
      </section>
      <ConversationOrderPanel
        conversationId={id}
        customerName={name}
        customerUsername={conversation.participantUsername}
        initialState={orderState}
        key={id}
      />
    </div>
  );
}

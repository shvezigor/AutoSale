import { getConversation, getConversationOrder } from '../../../../src/api/conversations';
import { getServerSession } from '../../../../src/auth/session';
import { SocialReplyComposer } from '../../../../src/components/social-reply-composer';
import { ConversationOrderPanel } from '../../../../src/components/conversation-order-panel';
import { createTranslator } from '../../../../src/i18n/translator';
import { authenticatedApiFetch } from '../../../../src/auth/session';
import { replyStyleSchema } from '../../../../../../packages/contracts/src/reply-drafts';

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conversation, orderState, session, replyStyleResponse] = await Promise.all([
    getConversation(id), getConversationOrder(id), getServerSession(), authenticatedApiFetch('/api/settings/reply-style'),
  ]);
  const replyStyle = replyStyleResponse.ok
    ? replyStyleSchema.safeParse(await replyStyleResponse.json()) : null;
  const draftsEnabled = replyStyle?.success === true && replyStyle.data.enabled;
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
        <SocialReplyComposer
          canManageSettings={session?.membershipRole === 'OWNER'}
          draftsEnabled={draftsEnabled}
          initialConversation={conversation}
          key={conversation.id}
        />
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

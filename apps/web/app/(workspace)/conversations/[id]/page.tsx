import { getConversation, getConversationOrder, getConversations } from '../../../../src/api/conversations';
import { getServerSession } from '../../../../src/auth/session';
import { InboxShell } from '../../../../src/components/inbox-shell';
import { InstagramReplyComposer } from '../../../../src/components/instagram-reply-composer';
import { ConversationOrderPanel } from '../../../../src/components/conversation-order-panel';

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [list, conversation, orderState, session] = await Promise.all([
    getConversations(), getConversation(id), getConversationOrder(id), getServerSession(),
  ]);
  const name = conversation.participantName ??
    (conversation.participantUsername ? `@${conversation.participantUsername}` : 'Клієнт Instagram');
  const accountLabel = conversation.participantName && conversation.participantUsername
    ? `@${conversation.participantUsername} · Instagram`
    : 'Instagram';

  return (
    <InboxShell conversations={list.items} selectedId={id}>
      <section className="conversation-panel">
        <header className="conversation-header">
          {conversation.participantAvatarUrl
            ? <img className="avatar large" src={conversation.participantAvatarUrl} alt={`Фото профілю ${name}`} />
            : <span className="avatar large" aria-hidden="true">{name[0]}</span>}
          <span><h2>{name}</h2><small>{accountLabel}</small></span>
        </header>
        <InstagramReplyComposer
          canManageSettings={session?.membershipRole === 'OWNER'}
          initialConversation={conversation}
        />
      </section>
      <ConversationOrderPanel
        conversationId={id}
        customerName={name}
        customerUsername={conversation.participantUsername}
        initialState={orderState}
      />
    </InboxShell>
  );
}

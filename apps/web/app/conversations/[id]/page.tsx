import { getConversation, getConversations } from '../../../src/api/conversations';
import { InboxShell } from '../../../src/components/inbox-shell';
import { MessageThread } from '../../../src/components/message-thread';
import { getServerSession } from '../../../src/auth/session';

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [list, conversation, session] = await Promise.all([getConversations(), getConversation(id), getServerSession()]);
  if (!session) return null;
  const name = conversation.participantName ??
    (conversation.participantUsername ? `@${conversation.participantUsername}` : 'Клієнт Instagram');
  const accountLabel = conversation.participantName && conversation.participantUsername
    ? `@${conversation.participantUsername} · Instagram`
    : 'Instagram';

  return (
    <InboxShell conversations={list.items} selectedId={id} session={session}>
      <section className="conversation-panel">
        <header className="conversation-header">
          {conversation.participantAvatarUrl
            ? <img className="avatar large" src={conversation.participantAvatarUrl} alt={`Фото профілю ${name}`} />
            : <span className="avatar large" aria-hidden="true">{name[0]}</span>}
          <span><h2>{name}</h2><small>{accountLabel}</small></span>
        </header>
        <div className="thread-scroll"><p className="day-label">Сьогодні</p><MessageThread conversation={conversation} /></div>
        <div className="composer" aria-label="Поле відповіді недоступне на цьому етапі">
          <span>Напишіть повідомлення…</span><button disabled type="button">Надіслати</button>
        </div>
      </section>
      <aside className="order-panel">
        <h2>Інформація про замовлення</h2>
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>Замовлення ще не створено</strong>
          <p>Створіть замовлення, щоб додати позиції та змінити статус.</p>
          <button type="button" disabled>Створити замовлення</button>
        </div>
        <section className="customer-data"><h3>Дані клієнта</h3><dl><div><dt>Канал</dt><dd>Instagram</dd></div><div><dt>Ім’я</dt><dd>{name}</dd></div>{conversation.participantUsername && <div><dt>Username</dt><dd>@{conversation.participantUsername}</dd></div>}</dl></section>
      </aside>
    </InboxShell>
  );
}

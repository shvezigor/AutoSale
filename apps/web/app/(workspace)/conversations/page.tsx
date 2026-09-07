export default function ConversationsPage() {
  return (
    <div className="conversation-detail-transition">
      <section className="conversation-empty">
        <div className="empty-icon" aria-hidden="true">↗</div>
        <h2>Оберіть діалог</h2>
        <p>Повідомлення клієнта з’являться тут.</p>
      </section>
      <aside className="order-panel">
        <h2>Інформація про замовлення</h2>
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>Замовлення ще не створено</strong>
          <p>Оберіть діалог, щоб переглянути дані клієнта.</p>
        </div>
      </aside>
    </div>
  );
}

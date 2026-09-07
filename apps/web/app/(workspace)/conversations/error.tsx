'use client';

export default function ConversationsError({ reset }: { reset: () => void }) {
  return <div className="conversation-detail-transition"><main className="route-state"><h1>Не вдалося завантажити діалог</h1><p>Перевірте з’єднання та спробуйте ще раз.</p><button onClick={reset} type="button">Повторити</button></main></div>;
}

'use client';

export default function ConversationsError({ reset }: { reset: () => void }) {
  return <main className="route-state"><h1>Не вдалося завантажити діалоги</h1><p>Перевірте з’єднання та спробуйте ще раз.</p><button onClick={reset} type="button">Повторити</button></main>;
}

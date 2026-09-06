'use client';

export default function CatalogueError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state">
    <h1>Не вдалося завантажити каталог</h1>
    <p>Перевірте з’єднання та спробуйте ще раз.</p>
    <button onClick={reset} type="button">Повторити</button>
  </main>;
}

'use client';

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state" role="alert">
    <h1>Не вдалося завантажити розділ</h1>
    <p>Спробуйте повторити запит.</p>
    <button className="primary-button" type="button" onClick={reset}>Повторити</button>
  </main>;
}

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function DataDeletionPage({ searchParams }: Props) {
  const { code } = await searchParams;

  return (
    <main className="route-state">
      <p className="eyebrow">Meta · AutoSale</p>
      <h1>Запит на видалення даних прийнято</h1>
      <p>
        Instagram-підключення від’єднано, а токен доступу більше не використовується AutoSale.
      </p>
      {code ? (
        <p>
          Код підтвердження: <strong>{code}</strong>
        </p>
      ) : (
        <p>Код підтвердження не передано.</p>
      )}
      <p>
        Цей запит не видаляє обліковий запис AutoSale або бізнес-записи, створені користувачами сервісу.
      </p>
    </main>
  );
}

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function DataDeletionPage({ searchParams }: Props) {
  const { code } = await searchParams;

  return (
    <main className="route-state">
      <p className="eyebrow">Meta · Sales AITO</p>
      <h1>Запит на видалення даних прийнято</h1>
      <p>
        Instagram-підключення від’єднано, а токен доступу більше не використовується Sales AITO.
      </p>
      {code ? (
        <p>
          Код підтвердження: <strong>{code}</strong>
        </p>
      ) : (
        <p>Код підтвердження не передано.</p>
      )}
      <p>
        Цей запит не видаляє обліковий запис Sales AITO або бізнес-записи, створені користувачами сервісу.
      </p>
    </main>
  );
}

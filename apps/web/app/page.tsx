import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="route-state">
      <h1>AutoSale</h1>
      <p>Робочий простір для замовлень з Instagram.</p>
      <Link href="/conversations">Відкрити діалоги</Link>
    </main>
  );
}

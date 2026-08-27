import Link from 'next/link';

import {
  OrderSettingsForm,
  type OrderSettings,
} from '../../src/components/order-settings-form';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const baseUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const [response, sheetsResponse] = await Promise.all([fetch(`${baseUrl}/api/settings/orders`, { cache: 'no-store' }), fetch(`${baseUrl}/api/settings/google-sheets`, { cache: 'no-store' })]);
  if (!response.ok || !sheetsResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;

  return (
    <main className="settings-layout">
      <aside className="primary-nav">
        <Link className="brand" href="/conversations">AutoSale</Link>
        <nav aria-label="Головна навігація">
          <Link className="nav-item" href="/conversations">Діалоги</Link>
          <Link className="nav-item" href="/orders">Замовлення</Link>
          <Link className="nav-item active" href="/settings">Налаштування</Link>
        </nav>
      </aside>
      <section className="settings-content">
        <header className="settings-header">
          <h1>Налаштування</h1>
          <p>Керуйте автоматичною обробкою Instagram-замовлень.</p>
        </header>
        <OrderSettingsForm initial={settings} />
        <GoogleSheetsSettingsForm initial={sheets} />
      </section>
    </main>
  );
}

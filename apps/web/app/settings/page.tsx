import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../src/components/order-settings-form';
import { PrimaryNavigation } from '../../src/components/primary-navigation';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [response, sheetsResponse, session] = await Promise.all([
    authenticatedApiFetch('/api/settings/orders'),
    authenticatedApiFetch('/api/settings/google-sheets'),
    getServerSession(),
  ]);
  if (!session) return null;
  if (!response.ok || !sheetsResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;
  return <main className="settings-layout"><PrimaryNavigation active="settings" session={session} /><section className="settings-content"><header className="settings-header"><h1>Налаштування</h1><p>Керуйте автоматичною обробкою Instagram-замовлень.</p></header><OrderSettingsForm initial={settings} /><GoogleSheetsSettingsForm initial={sheets} /></section></main>;
}

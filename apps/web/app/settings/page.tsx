import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../src/components/order-settings-form';
import { PrimaryNavigation } from '../../src/components/primary-navigation';
import { InstagramSettingsForm, type InstagramConnectionSummary } from '../../src/components/instagram-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [response, sheetsResponse, instagramResponse, session] = await Promise.all([
    authenticatedApiFetch('/api/settings/orders'),
    authenticatedApiFetch('/api/settings/google-sheets'),
    authenticatedApiFetch('/api/integrations/instagram'),
    getServerSession(),
  ]);
  if (!session) return null;
  if (!response.ok || !sheetsResponse.ok || !instagramResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;
  const instagram = (await instagramResponse.json()) as InstagramConnectionSummary;
  return <main className="settings-layout"><PrimaryNavigation active="settings" session={session} /><section className="settings-content"><header className="settings-header"><h1>Налаштування</h1><p>Керуйте автоматичною обробкою Instagram-замовлень.</p></header><InstagramSettingsForm initial={instagram} membershipRole={session.membershipRole} /><OrderSettingsForm initial={settings} /><GoogleSheetsSettingsForm initial={sheets} /></section></main>;
}

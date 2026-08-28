import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../src/components/order-settings-form';
import { PrimaryNavigation } from '../../src/components/primary-navigation';
import { InstagramSettingsForm, type InstagramConnectionSummary } from '../../src/components/instagram-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) return null;
  const instagramResponse = await authenticatedApiFetch('/api/integrations/instagram');
  if (!instagramResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const instagram = (await instagramResponse.json()) as InstagramConnectionSummary;
  if (session.membershipRole === 'MANAGER') return <SettingsLayout instagram={instagram} session={session} />;

  const [response, sheetsResponse] = await Promise.all([
    authenticatedApiFetch('/api/settings/orders'),
    authenticatedApiFetch('/api/settings/google-sheets'),
  ]);
  if (!response.ok || !sheetsResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;
  return <SettingsLayout instagram={instagram} session={session} settings={settings} sheets={sheets} />;
}

function SettingsLayout({
  instagram,
  session,
  settings,
  sheets,
}: {
  instagram: InstagramConnectionSummary;
  session: PublicSession;
  settings?: OrderSettings;
  sheets?: GoogleSheetsSettings;
}) {
  const isManager = session.membershipRole === 'MANAGER';
  return <main className="settings-layout"><PrimaryNavigation active="settings" session={session} /><section className="settings-content"><header className="settings-header"><h1>Налаштування</h1><p>{isManager ? 'Переглядайте стан підключення Instagram.' : 'Керуйте автоматичною обробкою Instagram-замовлень.'}</p></header><InstagramSettingsForm initial={instagram} membershipRole={session.membershipRole} />{settings && <OrderSettingsForm initial={settings} />}{sheets && <GoogleSheetsSettingsForm initial={sheets} />}</section></main>;
}

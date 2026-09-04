import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../src/components/order-settings-form';
import { PrimaryNavigation } from '../../src/components/primary-navigation';
import { InstagramSettingsForm, type InstagramConnectionSummary } from '../../src/components/instagram-settings-form';
import { DemoScenarioCard } from '../../src/components/demo-scenario-card';
import { CatalogueSourceSettings, type CatalogueSourceConfiguration, type CatalogueSourceHealth } from '../../src/components/catalogue-source-settings';
import type { GoogleConnectionSummary } from '../../src/components/google-connection-settings';
import { SettingsTabs, type SettingsTabId } from '../../src/components/settings-tabs';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ tab?: string | string[]; action?: string | string[] }> } = {}) {
  const session = await getServerSession();
  if (!session) return null;
  const query = await searchParams;
  const requestedTab = textParam(query.tab);
  const pickerAction = textParam(query.action);
  const initialTab: SettingsTabId = requestedTab === 'google' || requestedTab === 'data' ? 'data' : requestedTab === 'orders' ? 'orders' : 'social';
  const [instagramResponse, googleResponse] = await Promise.all([
    authenticatedApiFetch('/api/integrations/instagram'),
    authenticatedApiFetch('/api/integrations/google'),
  ]);
  if (!instagramResponse.ok || !googleResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const instagram = (await instagramResponse.json()) as InstagramConnectionSummary;
  const google = (await googleResponse.json()) as GoogleConnectionSummary;
  if (session.membershipRole === 'MANAGER') return <SettingsLayout google={google} instagram={instagram} initialTab={initialTab} pickerAction={pickerAction} session={session} />;

  const [response, sheetsResponse, catalogueSourcesResponse] = await Promise.all([
    authenticatedApiFetch('/api/settings/orders'),
    authenticatedApiFetch('/api/settings/google-sheets'),
    authenticatedApiFetch('/api/catalogue/sources'),
  ]);
  if (!response.ok || !sheetsResponse.ok || !catalogueSourcesResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;
  const catalogueSources = await catalogueSourcesResponse.json() as CatalogueSourceHealth[];
  const catalogueConfigurations = await Promise.all(catalogueSources.map(async (source) => {
    const sourceResponse = await authenticatedApiFetch(`/api/catalogue/sources/${source.id}`);
    if (!sourceResponse.ok) throw new Error('Не вдалося завантажити джерело каталогу');
    return await sourceResponse.json() as CatalogueSourceConfiguration;
  }));
  return <SettingsLayout google={google} instagram={instagram} initialTab={initialTab} pickerAction={pickerAction} session={session} settings={settings} sheets={sheets} catalogueSources={catalogueSources} catalogueConfigurations={catalogueConfigurations} />;
}

function SettingsLayout({
  instagram,
  google,
  initialTab,
  pickerAction,
  session,
  settings,
  sheets,
  catalogueSources = [],
  catalogueConfigurations = [],
}: {
  instagram: InstagramConnectionSummary;
  google: GoogleConnectionSummary;
  initialTab: SettingsTabId;
  pickerAction: string;
  session: PublicSession;
  settings?: OrderSettings;
  sheets?: GoogleSheetsSettings;
  catalogueSources?: CatalogueSourceHealth[];
  catalogueConfigurations?: CatalogueSourceConfiguration[];
}) {
  const isManager = session.membershipRole === 'MANAGER';
  const googleConnected = google.status === 'ACTIVE';
  const tabs = [
    {
      id: 'social' as const,
      label: 'Соцмережі',
      description: 'Instagram',
      content: <section className="settings-section"><div className="settings-section-heading"><h2>Підключення каналів</h2><p>Керуйте каналами, з яких AutoSale отримує діалоги та замовлення.</p></div><InstagramSettingsForm initial={instagram} membershipRole={session.membershipRole} /></section>,
    },
    {
      id: 'data' as const,
      label: 'Дані',
      description: 'Товари й експорт',
      content: <section className="settings-section data-workspace"><div className="settings-section-heading"><h2>Дані та синхронізація</h2><p>{isManager ? 'Стан підключень без доступу до таблиць і даних клієнтів.' : 'Оберіть, звідки брати товари та куди записувати підтверджені замовлення.'}</p>{!isManager && <span className={`data-account-state status-${google.status.toLowerCase()}`}>{googleConnected && google.email ? `Google: ${google.email}` : 'Google попросить доступ під час вибору таблиці'}</span>}</div>{settings ? <div className="data-workspace-grid"><CatalogueSourceSettings role={session.membershipRole!} sources={catalogueSources} configurations={catalogueConfigurations} googleConnected={googleConnected} autoOpenPicker={pickerAction === 'pick-catalogue'} /><GoogleSheetsSettingsForm initial={sheets!} googleConnected={googleConnected} autoOpenPicker={pickerAction === 'pick-orders'} /></div> : <div className="settings-card"><p>Власник керує джерелами даних. Менеджерам доступний лише стан інтеграцій.</p></div>}</section>,
    },
    ...(settings ? [{
      id: 'orders' as const,
      label: 'Замовлення',
      description: 'Правила обробки',
      content: <section className="settings-section"><div className="settings-section-heading"><h2>Правила обробки</h2><p>Визначте, коли менеджер має перевірити замовлення, яке розпізнав AI.</p></div><OrderSettingsForm initial={settings} /><DemoScenarioCard /></section>,
    }] : []),
  ];
  return <main className="settings-layout"><PrimaryNavigation active="settings" session={session} /><section className="settings-content"><header className="settings-header"><h1>Налаштування</h1><p>{isManager ? 'Переглядайте стан підключень.' : 'Керуйте підключеннями та автоматичною обробкою замовлень.'}</p></header><SettingsTabs initialTab={initialTab} tabs={tabs} /></section></main>;
}

function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? ''; }

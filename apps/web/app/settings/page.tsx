import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from '../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../src/components/order-settings-form';
import { PrimaryNavigation } from '../../src/components/primary-navigation';
import { InstagramSettingsForm, type InstagramConnectionSummary } from '../../src/components/instagram-settings-form';
import { DemoScenarioCard } from '../../src/components/demo-scenario-card';
import { CatalogueSourceSettings, type CatalogueSourceConfiguration, type CatalogueSourceHealth } from '../../src/components/catalogue-source-settings';
import { GoogleConnectionSettings, type GoogleConnectionSummary } from '../../src/components/google-connection-settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) return null;
  const [instagramResponse, googleResponse] = await Promise.all([
    authenticatedApiFetch('/api/integrations/instagram'),
    authenticatedApiFetch('/api/integrations/google'),
  ]);
  if (!instagramResponse.ok || !googleResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const instagram = (await instagramResponse.json()) as InstagramConnectionSummary;
  const google = (await googleResponse.json()) as GoogleConnectionSummary;
  if (session.membershipRole === 'MANAGER') return <SettingsLayout google={google} instagram={instagram} session={session} />;

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
  return <SettingsLayout google={google} instagram={instagram} session={session} settings={settings} sheets={sheets} catalogueSources={catalogueSources} catalogueConfigurations={catalogueConfigurations} />;
}

function SettingsLayout({
  instagram,
  google,
  session,
  settings,
  sheets,
  catalogueSources = [],
  catalogueConfigurations = [],
}: {
  instagram: InstagramConnectionSummary;
  google: GoogleConnectionSummary;
  session: PublicSession;
  settings?: OrderSettings;
  sheets?: GoogleSheetsSettings;
  catalogueSources?: CatalogueSourceHealth[];
  catalogueConfigurations?: CatalogueSourceConfiguration[];
}) {
  const isManager = session.membershipRole === 'MANAGER';
  const googleConnected = google.status === 'ACTIVE';
  return <main className="settings-layout"><PrimaryNavigation active="settings" session={session} /><section className="settings-content"><header className="settings-header"><h1>Налаштування</h1><p>{isManager ? 'Переглядайте стан підключень.' : 'Керуйте підключеннями та автоматичною обробкою замовлень.'}</p></header><nav className="settings-index" aria-label="Розділи налаштувань"><a href="#social">Соцмережі <span>Instagram</span></a><a href="#google">Google <span>Sheets і каталог</span></a>{settings && <a href="#orders">Замовлення <span>Правила підтвердження</span></a>}</nav><section id="social" className="settings-section"><div className="settings-section-heading"><span className="settings-kicker">01 / Соцмережі</span><h2>Підключення каналів</h2></div><InstagramSettingsForm initial={instagram} membershipRole={session.membershipRole} /></section><section id="google" className="settings-section"><div className="settings-section-heading"><span className="settings-kicker">02 / Google</span><h2>Google Sheets</h2><p>{isManager ? 'Стан Google-інтеграції без доступу до даних акаунта чи таблиць.' : 'Підключіть Google один раз, а потім окремо оберіть таблиці для каталогу та продажів.'}</p></div><GoogleConnectionSettings initial={google} role={session.membershipRole!} />{settings && <><GoogleSheetsSettingsForm initial={sheets!} googleConnected={googleConnected} /><CatalogueSourceSettings role={session.membershipRole!} sources={catalogueSources} configurations={catalogueConfigurations} googleConnected={googleConnected} /></>}</section>{settings && <section id="orders" className="settings-section"><div className="settings-section-heading"><span className="settings-kicker">03 / Замовлення</span><h2>Правила обробки</h2></div><OrderSettingsForm initial={settings} /><DemoScenarioCard /></section>}</section></main>;
}

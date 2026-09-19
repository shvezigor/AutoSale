import { authenticatedApiFetch, getServerSession } from '../../../src/auth/session';
import type { PublicSession } from '../../../../../packages/contracts/src/auth';
import type { GoogleSheetsSettings } from '../../../src/components/google-sheets-settings-form';
import { OrderSettingsForm, type OrderSettings } from '../../../src/components/order-settings-form';
import type { InstagramConnectionSummary } from '../../../src/components/instagram-settings-form';
import { DemoScenarioCard } from '../../../src/components/demo-scenario-card';
import type { CatalogueSourceConfiguration, CatalogueSourceHealth } from '../../../src/components/catalogue-source-settings';
import type { GoogleConnectionSummary } from '../../../src/components/google-connection-settings';
import { SettingsTabs, type SettingsTabId } from '../../../src/components/settings-tabs';
import type { TelegramConnectionSummary } from '../../../src/components/telegram-settings-card';
import { TelegramSupplierSettings } from '../../../src/components/telegram-supplier-settings';
import type { TelegramNotificationPreferences, TelegramSupplierSettings as TelegramSupplierConfiguration } from '../../../../../packages/contracts/src/telegram';
import type { DeliverySettingsSummary } from '../../../src/components/delivery-settings-card';
import type { MeestSettingsSummary } from '../../../src/components/meest-settings-card';
import type { UkrposhtaSettingsSummary } from '../../../src/components/ukrposhta-settings-card';
import { DeliveryCarrierHub } from '../../../src/components/delivery-carrier-hub';
import { SocialChannelHub } from '../../../src/components/social-channel-hub';
import { NotificationChannelHub } from '../../../src/components/notification-channel-hub';
import { DataIntegrationHub } from '../../../src/components/data-integration-hub';
import { createTranslator, type Translator } from '../../../src/i18n/translator';
import type { CommercialSettingsSummary } from '../../../../../packages/contracts/src/commercial';
import { CommercialSettingsHub } from '../../../src/components/commercial-settings-hub';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ tab?: string | string[]; action?: string | string[] }> } = {}) {
  const session = await getServerSession();
  if (!session) return null;
  const t = createTranslator(session.locale ?? 'uk');
  const query = await searchParams;
  const requestedTab = textParam(query.tab);
  const pickerAction = textParam(query.action);
  const initialTab: SettingsTabId = requestedTab === 'google' || requestedTab === 'data'
    ? 'data'
    : requestedTab === 'social'
      ? 'social'
      : requestedTab === 'orders'
        ? 'orders'
        : requestedTab === 'telegram' || requestedTab === 'notifications'
          ? 'notifications'
          : requestedTab === 'suppliers'
            ? 'suppliers'
            : requestedTab === 'delivery'
              ? 'delivery'
              : requestedTab === 'payments' ? 'payments' : 'data';
  const [instagramResponse, googleResponse, telegramResponse, telegramPreferencesResponse, deliveryResponse, meestResponse, ukrposhtaResponse, legalEntitiesResponse, bankAccountsResponse] = await Promise.all([
    authenticatedApiFetch('/api/integrations/instagram'),
    authenticatedApiFetch('/api/integrations/google'),
    authenticatedApiFetch('/api/integrations/telegram'),
    authenticatedApiFetch('/api/integrations/telegram/preferences'),
    authenticatedApiFetch('/api/integrations/delivery'),
    authenticatedApiFetch('/api/integrations/delivery/meest'),
    authenticatedApiFetch('/api/integrations/delivery/ukrposhta'),
    authenticatedApiFetch('/api/settings/legal-entities'),
    authenticatedApiFetch('/api/settings/bank-accounts'),
  ]);
  if (!instagramResponse.ok || !googleResponse.ok || !telegramResponse.ok || !telegramPreferencesResponse.ok || !deliveryResponse.ok || !meestResponse.ok || !ukrposhtaResponse.ok || !legalEntitiesResponse.ok || !bankAccountsResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const instagram = (await instagramResponse.json()) as InstagramConnectionSummary;
  const google = (await googleResponse.json()) as GoogleConnectionSummary;
  const telegram = (await telegramResponse.json()) as TelegramConnectionSummary;
  const telegramPreferences = (await telegramPreferencesResponse.json()) as TelegramNotificationPreferences;
  const delivery = (await deliveryResponse.json()) as DeliverySettingsSummary;
  const meest = (await meestResponse.json()) as MeestSettingsSummary;
  const ukrposhta = (await ukrposhtaResponse.json()) as UkrposhtaSettingsSummary;
  const commercialSettings: CommercialSettingsSummary = {
    legalEntities: await legalEntitiesResponse.json(),
    bankAccounts: await bankAccountsResponse.json(),
  };
  if (session.membershipRole === 'MANAGER') return <SettingsLayout t={t} google={google} instagram={instagram} telegram={telegram} telegramPreferences={telegramPreferences} delivery={delivery} meest={meest} ukrposhta={ukrposhta} commercialSettings={commercialSettings} initialTab={initialTab} pickerAction={pickerAction} session={session} />;

  const [supplierResponse, response, sheetsResponse, catalogueSourcesResponse] = await Promise.all([
    authenticatedApiFetch('/api/integrations/telegram/supplier'),
    authenticatedApiFetch('/api/settings/orders'),
    authenticatedApiFetch('/api/settings/google-sheets'),
    authenticatedApiFetch('/api/catalogue/sources'),
  ]);
  if (!supplierResponse.ok || !response.ok || !sheetsResponse.ok || !catalogueSourcesResponse.ok) throw new Error('Не вдалося завантажити налаштування');
  const supplier = (await supplierResponse.json()) as TelegramSupplierConfiguration;
  const settings = (await response.json()) as OrderSettings;
  const sheets = (await sheetsResponse.json()) as GoogleSheetsSettings;
  const catalogueSources = await catalogueSourcesResponse.json() as CatalogueSourceHealth[];
  const catalogueConfigurations = await Promise.all(catalogueSources.map(async (source) => {
    const sourceResponse = await authenticatedApiFetch(`/api/catalogue/sources/${source.id}`);
    if (!sourceResponse.ok) throw new Error('Не вдалося завантажити джерело каталогу');
    return await sourceResponse.json() as CatalogueSourceConfiguration;
  }));
  return <SettingsLayout t={t} google={google} instagram={instagram} telegram={telegram} telegramPreferences={telegramPreferences} delivery={delivery} meest={meest} ukrposhta={ukrposhta} commercialSettings={commercialSettings} supplier={supplier} initialTab={initialTab} pickerAction={pickerAction} session={session} settings={settings} sheets={sheets} catalogueSources={catalogueSources} catalogueConfigurations={catalogueConfigurations} />;
}

function SettingsLayout({
  t,
  instagram,
  google,
  telegram,
  telegramPreferences,
  delivery,
  meest,
  ukrposhta,
  commercialSettings,
  supplier,
  initialTab,
  pickerAction,
  session,
  settings,
  sheets,
  catalogueSources = [],
  catalogueConfigurations = [],
}: {
  t: Translator;
  instagram: InstagramConnectionSummary;
  google: GoogleConnectionSummary;
  telegram: TelegramConnectionSummary;
  telegramPreferences: TelegramNotificationPreferences;
  delivery: DeliverySettingsSummary;
  meest: MeestSettingsSummary;
  ukrposhta: UkrposhtaSettingsSummary;
  commercialSettings: CommercialSettingsSummary;
  supplier?: TelegramSupplierConfiguration;
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
      id: 'data' as const,
      label: t('settings.dataTab'),
      description: t('settings.dataTabDescription'),
      content: <section className="settings-section data-workspace"><div className="settings-section-heading"><h2>{t('settings.dataTitle')}</h2><p>{isManager ? t('settings.dataManagerDescription') : t('settings.dataOwnerDescription')}</p></div>{settings ? <DataIntegrationHub sources={catalogueSources} configurations={catalogueConfigurations} sheets={sheets!} googleConnected={googleConnected} googleAccountEmail={google.email} autoOpenCatalogue={pickerAction === 'pick-catalogue'} autoOpenOrders={pickerAction === 'pick-orders'} /> : <div className="settings-card"><p>{t('settings.ownerManagesData')}</p></div>}</section>,
    },
    {
      id: 'social' as const,
      label: t('settings.socialTab'), description: t('settings.socialTabDescription'),
      content: <section className="settings-section"><div className="settings-section-heading"><h2>{t('settings.socialTitle')}</h2><p>{t('settings.socialDescription')}</p></div><SocialChannelHub instagram={instagram} membershipRole={session.membershipRole} /></section>,
    },
    ...(settings ? [{
      id: 'orders' as const,
      label: t('settings.ordersTab'), description: t('settings.ordersTabDescription'),
      content: <section className="settings-section"><div className="settings-section-heading"><h2>{t('settings.ordersTitle')}</h2><p>{t('settings.ordersDescription')}</p></div><OrderSettingsForm initial={settings} /><DemoScenarioCard /></section>,
    }] : []),
    ...(supplier ? [{
      id: 'suppliers' as const,
      label: t('settings.suppliersTab'), description: t('settings.suppliersTabDescription'),
      content: <section className="settings-section"><div className="settings-section-heading"><h2>{t('settings.suppliersTitle')}</h2><p>{t('settings.suppliersDescription')}</p></div><TelegramSupplierSettings initial={supplier} /></section>,
    }] : []),
    {
      id: 'delivery' as const,
      label: t('settings.deliveryTab'), description: t('settings.deliveryTabDescription'),
      content: <section className="settings-section delivery-settings-section"><div className="settings-section-heading"><h2>{t('settings.deliveryTitle')}</h2><p>{t('settings.deliveryDescription')}</p></div><DeliveryCarrierHub delivery={delivery} meest={meest} ukrposhta={ukrposhta} role={session.membershipRole!} /></section>,
    },
    {
      id: 'payments' as const,
      label: t('settings.paymentsTab'), description: t('settings.paymentsTabDescription'),
      content: <section className="settings-section"><div className="settings-section-heading"><h2>{t('settings.paymentsTitle')}</h2><p>{t('settings.paymentsDescription')}</p></div><CommercialSettingsHub initial={commercialSettings} role={session.membershipRole!} /></section>,
    },
    {
      id: 'notifications' as const,
      label: t('settings.notificationsTab'), description: t('settings.notificationsTabDescription'),
      content: <section className="settings-section"><div className="settings-section-heading"><h2>{t('settings.notificationsTitle')}</h2><p>{t('settings.notificationsDescription')}</p></div><NotificationChannelHub telegram={telegram} telegramPreferences={telegramPreferences} /></section>,
    },
  ];
  return <main className="settings-layout-content"><section className="settings-content"><header className="settings-header"><h1>{t('settings.title')}</h1><p>{isManager ? t('settings.managerDescription') : t('settings.ownerDescription')}</p></header><SettingsTabs initialTab={initialTab} tabs={tabs} /></section></main>;
}

function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? ''; }

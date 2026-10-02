import Link from 'next/link';

import { authenticatedApiFetch, getServerSession } from '../../../src/auth/session';
import { createTranslator, type Translator } from '../../../src/i18n/translator';

export const dynamic = 'force-dynamic';

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  href: string;
  required: boolean;
  ready: boolean;
};

type CatalogueSource = { status?: string };
type InstagramSummary = { status?: string };
type FacebookSummary = { status?: string };
type OrderSettings = { intentDetectionMode?: string; approvalMode?: string };
type DeliveryConnection = { status?: string; senderProfile?: unknown };
type DeliverySummary = { connections?: DeliveryConnection[] };
type SingleDeliverySummary = { connection?: DeliveryConnection | null };
type SupplierSummary = { selectedDestinationId?: string | null; destinations?: Array<{ id?: string }> };
type TelegramSummary = { personal?: { connected?: boolean } };
type LegalEntity = { id?: string; active?: boolean };
type BankAccount = { legalEntityId?: string; active?: boolean };

export default async function OnboardingPage() {
  const session = await getServerSession();
  if (!session) return null;
  const t = createTranslator(session.locale ?? 'uk');
  const snapshot = await loadOnboardingSnapshot();
  const required = requiredSteps(t, snapshot);
  const optional = optionalSteps(t, snapshot);
  const completedRequired = required.filter((step) => step.ready).length;
  const next = required.find((step) => !step.ready) ?? null;
  const complete = completedRequired === required.length;

  return <main className="onboarding-page">
    <header className="onboarding-header">
      <div>
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.description')}</p>
      </div>
      <div className="onboarding-progress" aria-label={t('onboarding.progressLabel')} aria-valuemax={required.length} aria-valuemin={0} aria-valuenow={completedRequired} role="progressbar">
        <strong>{t('onboarding.progress', { completed: completedRequired, total: required.length })}</strong>
        <span className="onboarding-progress-segments" aria-hidden="true">
          {required.map((step) => <i className={step.ready ? 'is-ready' : ''} key={step.id} />)}
        </span>
      </div>
    </header>

    <div className="onboarding-layout">
      <div className="onboarding-checklist">
        <StepGroup heading={t('onboarding.requiredTitle')} steps={required} t={t} />
        <StepGroup heading={t('onboarding.optionalTitle')} intro={t('onboarding.optionalDescription')} steps={optional} t={t} />
      </div>

      <aside className="onboarding-next" aria-labelledby="onboarding-next-title">
        <span className={`onboarding-next-state ${complete ? 'is-complete' : ''}`}>{complete ? t('onboarding.ready') : t('onboarding.next')}</span>
        <h2 id="onboarding-next-title">{complete ? t('onboarding.completeTitle') : next!.title}</h2>
        <p>{complete ? t('onboarding.completeDescription') : next!.description}</p>
        <Link className="primary-button" href={complete ? '/orders' : next!.href}>
          {complete ? t('onboarding.openOrders') : t('onboarding.continue')}
        </Link>
        <small>{complete ? t('onboarding.optionalLater') : t('onboarding.resumeHint')}</small>
      </aside>
    </div>
  </main>;
}

function StepGroup({ heading, intro, steps, t }: { heading: string; intro?: string; steps: OnboardingStep[]; t: Translator }) {
  return <section className="onboarding-group" aria-labelledby={`onboarding-${steps[0]!.required ? 'required' : 'optional'}-title`}>
    <div className="onboarding-group-heading">
      <h2 id={`onboarding-${steps[0]!.required ? 'required' : 'optional'}-title`}>{heading}</h2>
      {intro && <p>{intro}</p>}
    </div>
    <ol className="onboarding-steps">
      {steps.map((step, index) => <li className={`onboarding-step ${step.ready ? 'is-ready' : ''}`} data-testid={`onboarding-step-${step.id}`} key={step.id}>
        <span className="onboarding-step-number" aria-hidden="true">{index + 1}</span>
        <div className="onboarding-step-copy">
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </div>
        <div className="onboarding-step-action">
          <span className={`onboarding-step-status ${step.ready ? 'is-ready' : step.required ? 'is-required' : 'is-optional'}`}>
            {step.ready ? t('onboarding.ready') : step.required ? t('onboarding.needsSetup') : t('onboarding.optional')}
          </span>
          <Link className="text-button" href={step.href}>{step.ready ? t('onboarding.review') : t('onboarding.configure')}</Link>
        </div>
      </li>)}
    </ol>
  </section>;
}

function requiredSteps(t: Translator, snapshot: Awaited<ReturnType<typeof loadOnboardingSnapshot>>): OnboardingStep[] {
  return [
    step('catalogue', t('onboarding.steps.catalogue.title'), t('onboarding.steps.catalogue.description'), '/settings?tab=data&action=pick-catalogue', true, snapshot.catalogueReady),
    step('channel', t('onboarding.steps.channel.title'), t('onboarding.steps.channel.description'), '/settings?tab=social', true, snapshot.salesChannelReady),
    step('orders', t('onboarding.steps.orders.title'), t('onboarding.steps.orders.description'), '/settings?tab=orders', true, snapshot.orderRulesReady),
  ];
}

function optionalSteps(t: Translator, snapshot: Awaited<ReturnType<typeof loadOnboardingSnapshot>>): OnboardingStep[] {
  return [
    step('delivery', t('onboarding.steps.delivery.title'), t('onboarding.steps.delivery.description'), '/settings?tab=delivery', false, snapshot.deliveryReady),
    step('suppliers', t('onboarding.steps.suppliers.title'), t('onboarding.steps.suppliers.description'), '/settings?tab=suppliers', false, snapshot.supplierReady),
    step('notifications', t('onboarding.steps.notifications.title'), t('onboarding.steps.notifications.description'), '/settings?tab=notifications', false, snapshot.notificationsReady),
    step('payments', t('onboarding.steps.payments.title'), t('onboarding.steps.payments.description'), '/settings?tab=payments', false, snapshot.paymentsReady),
  ];
}

function step(id: string, title: string, description: string, href: string, required: boolean, ready: boolean): OnboardingStep {
  return { id, title, description, href, required, ready };
}

async function loadOnboardingSnapshot() {
  const [catalogue, instagram, facebook, orders, delivery, meest, ukrposhta, supplier, telegram, legalEntities, bankAccounts] = await Promise.all([
    safeApiJson<CatalogueSource[]>('/api/catalogue/sources'),
    safeApiJson<InstagramSummary>('/api/integrations/instagram'),
    safeApiJson<FacebookSummary>('/api/integrations/facebook'),
    safeApiJson<OrderSettings>('/api/settings/orders'),
    safeApiJson<DeliverySummary>('/api/integrations/delivery'),
    safeApiJson<SingleDeliverySummary>('/api/integrations/delivery/meest'),
    safeApiJson<SingleDeliverySummary>('/api/integrations/delivery/ukrposhta'),
    safeApiJson<SupplierSummary>('/api/integrations/telegram/supplier'),
    safeApiJson<TelegramSummary>('/api/integrations/telegram'),
    safeApiJson<LegalEntity[]>('/api/settings/legal-entities'),
    safeApiJson<BankAccount[]>('/api/settings/bank-accounts'),
  ]);
  const activeLegalEntityIds = new Set((legalEntities ?? []).filter((entity) => entity.active && entity.id).map((entity) => entity.id!));
  const deliveryConnections = [
    ...(delivery?.connections ?? []),
    ...(meest?.connection ? [meest.connection] : []),
    ...(ukrposhta?.connection ? [ukrposhta.connection] : []),
  ];
  const selectedSupplier = supplier?.selectedDestinationId;
  return {
    catalogueReady: (catalogue ?? []).some((source) => source.status === 'ACTIVE'),
    salesChannelReady: instagram?.status === 'ACTIVE' || facebook?.status === 'ACTIVE',
    orderRulesReady: Boolean(orders?.intentDetectionMode && orders?.approvalMode),
    deliveryReady: deliveryConnections.some((connection) => connection.status === 'ACTIVE' && connection.senderProfile),
    supplierReady: Boolean(selectedSupplier && supplier?.destinations?.some((destination) => destination.id === selectedSupplier)),
    notificationsReady: telegram?.personal?.connected === true,
    paymentsReady: (bankAccounts ?? []).some((account) => account.active && account.legalEntityId && activeLegalEntityIds.has(account.legalEntityId)),
  };
}

async function safeApiJson<T>(path: string): Promise<T | null> {
  try {
    const response = await authenticatedApiFetch(path);
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

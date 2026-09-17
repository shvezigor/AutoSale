import Image from 'next/image';
import Link from 'next/link';

import { integrations } from '../content/integrations';
import { pricingPlans } from '../content/pricing';
import { siteCopy } from '../content/site';
import { localizedPath, type Locale } from '../routing/locales';
import { StatusBadge } from './status-badge';

const homeCopy = {
  uk: {
    eyebrow: 'AI-оператор для social commerce',
    title: 'Продажі з діалогів. Без ручної рутини.',
    lead: 'Sales AITO розпізнає замовлення, перевіряє дані й веде покупця до оформлення.',
    proofTitle: 'Від повідомлення до готового замовлення',
    proofText: 'Система вже поєднує Instagram, AI-розпізнавання, каталог товарів і Google Sheets у контрольований процес.',
    steps: [
      ['01', 'Розуміє запит', 'Виділяє товар, кількість, контактні дані й адресу з живого діалогу.'],
      ['02', 'Перевіряє замовлення', 'Зіставляє позиції з каталогом і показує, що потребує уваги менеджера.'],
      ['03', 'Фіксує результат', 'Створює замовлення та експортує підтверджені дані без повторного введення.'],
    ],
    aiTitle: 'Не просто чат-бот. Оператор, що рухає продаж уперед.',
    aiText: 'Мета Sales AITO: самостійно підтримувати розмову, оформлювати замовлення, створювати накладну й залучати постачальника лише коли це справді потрібно.',
    now: 'Працює зараз',
    nowItems: ['Розпізнавання замовлень з Instagram', 'Каталог і перевірка товарів', 'Ручне підтвердження складних випадків', 'Експорт у Google Sheets'],
    next: 'Наступний рівень автоматизації',
    nextItems: ['Facebook, Threads, TikTok і Viber', 'Автоматичні відповіді в діалозі', 'Накладні поштових служб', 'Повідомлення постачальнику про відсутній товар'],
    integrationsTitle: 'Один процес для всіх каналів',
    integrationsText: 'Чітко показуємо, що доступно вже сьогодні, а що команда додає далі.',
    pricingTitle: '30 днів, щоб перевірити на власних замовленнях',
    pricingText: 'Без картки. Платний план обираєте лише після того, як побачили цінність.',
    perMonth: 'грн / місяць',
    planCta: 'Почати безкоштовно',
    pricingLink: 'Порівняти тарифи',
    faqTitle: 'Коротко про головне',
    faq: [
      ['Чи це лише для Instagram?', 'Ні. Instagram є першим доступним каналом. Facebook, Threads, TikTok і Viber вже в плані розвитку платформи.'],
      ['AI відправляє замовлення без контролю?', 'Зараз менеджер може перевіряти складні випадки. Рівень автоматизації зростатиме разом із надійністю правил і даних.'],
      ['Коли починається trial?', '30 днів починаються після підключення першого підтримуваного каналу або завершення імпорту каталогу.'],
      ['Чи можна увійти в кабінет із цього сайту?', 'Так. Кнопка входу веде до наявного кабінету Sales AITO.'],
    ],
    finalTitle: 'Дайте AI рутинну частину продажів.',
    finalText: 'Підключіть робочий процес і перевірте Sales AITO на реальних зверненнях протягом 30 днів.',
  },
  en: {
    eyebrow: 'AI operator for social commerce',
    title: 'Turn conversations into orders. Skip the manual work.',
    lead: 'Sales AITO recognises orders, validates details and guides each buyer towards completion.',
    proofTitle: 'From first message to a ready order',
    proofText: 'The system already connects Instagram, AI recognition, your catalogue and Google Sheets in one controlled process.',
    steps: [
      ['01', 'Understands intent', 'Extracts products, quantity, contact details and address from a natural conversation.'],
      ['02', 'Validates the order', 'Matches items against the catalogue and surfaces anything that needs a manager.'],
      ['03', 'Records the outcome', 'Creates an order and exports confirmed data without duplicate entry.'],
    ],
    aiTitle: 'More than a chatbot. An operator that moves the sale forward.',
    aiText: 'The Sales AITO direction is fully autonomous: hold the conversation, create the order, issue the shipping label and contact a supplier only when needed.',
    now: 'Available now',
    nowItems: ['Instagram order recognition', 'Catalogue and product validation', 'Human review for uncertain cases', 'Google Sheets export'],
    next: 'Next automation layer',
    nextItems: ['Facebook, Threads, TikTok and Viber', 'Autonomous customer replies', 'Postal service shipping labels', 'Supplier messages for unavailable products'],
    integrationsTitle: 'One process across every channel',
    integrationsText: 'A clear view of what is available now and what the team is building next.',
    pricingTitle: '30 days to prove it with your own orders',
    pricingText: 'No card required. Choose a paid plan only after you see the value.',
    perMonth: 'UAH / month',
    planCta: 'Start free',
    pricingLink: 'Compare plans',
    faqTitle: 'The essentials',
    faq: [
      ['Is this only for Instagram?', 'No. Instagram is the first available channel. Facebook, Threads, TikTok and Viber are part of the platform roadmap.'],
      ['Does AI send orders without control?', 'Managers can review uncertain cases today. Automation will increase as rules and data prove reliable.'],
      ['When does the trial begin?', 'The 30 days start after the first supported channel connection or a completed catalogue import.'],
      ['Can I access the workspace from this site?', 'Yes. The sign-in action opens the existing Sales AITO workspace.'],
    ],
    finalTitle: 'Give the repetitive sales work to AI.',
    finalText: 'Connect your workflow and test Sales AITO on real enquiries for 30 days.',
  },
} as const;

export function HomePage({ locale }: { locale: Locale }) {
  const copy = homeCopy[locale];
  const site = siteCopy[locale];
  const highlightedIntegrations = integrations.slice(0, 6);

  return (
    <main id="main-content">
      <section className="marketing-hero">
        <div className="marketing-shell marketing-hero__grid">
          <div className="marketing-hero__copy">
            <p className="marketing-eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p className="marketing-hero__lead">{copy.lead}</p>
            <div className="marketing-actions">
              <Link className="marketing-button" href="/register">{site.startFree}</Link>
              <Link className="marketing-button marketing-button--secondary" href={localizedPath(locale, '/demo')}>{site.bookDemo}</Link>
            </div>
          </div>
          <div className="marketing-hero__visual">
            <Image src="/images/sales-aito-ai-operator-hero.png" width={1536} height={1024} priority sizes="(max-width: 800px) 100vw, 55vw" alt="" />
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--light">
        <div className="marketing-shell">
          <div className="section-heading section-heading--narrow">
            <h2>{copy.proofTitle}</h2>
            <p>{copy.proofText}</p>
          </div>
          <ol className="workflow-steps">
            {copy.steps.map(([number, title, description]) => (
              <li key={number}>
                <span>{number}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="marketing-section marketing-ai-section">
        <div className="marketing-shell marketing-ai-grid">
          <div className="marketing-ai-intro">
            <h2>{copy.aiTitle}</h2>
            <p>{copy.aiText}</p>
            <Link className="text-link" href={localizedPath(locale, '/features/ai-sales-operator')}>
              {locale === 'uk' ? 'Як працює AI-оператор' : 'How the AI operator works'} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="capability-columns">
            <div>
              <h3><span className="capability-signal capability-signal--live" aria-hidden="true" />{copy.now}</h3>
              <ul>{copy.nowItems.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h3><span className="capability-signal capability-signal--next" aria-hidden="true" />{copy.next}</h3>
              <ul>{copy.nextItems.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--light">
        <div className="marketing-shell">
          <div className="section-heading">
            <h2>{copy.integrationsTitle}</h2>
            <p>{copy.integrationsText}</p>
          </div>
          <div className="integration-list">
            {highlightedIntegrations.map((integration) => (
              <article key={integration.id}>
                <div><h3>{integration.name}</h3><StatusBadge locale={locale} status={integration.status} /></div>
                <p>{integration.summary[locale]}</p>
              </article>
            ))}
          </div>
          <Link className="text-link text-link--dark" href={localizedPath(locale, '/integrations')}>
            {locale === 'uk' ? 'Усі інтеграції та статуси' : 'All integrations and statuses'} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="marketing-section marketing-pricing-preview">
        <div className="marketing-shell">
          <div className="section-heading section-heading--center">
            <h2>{copy.pricingTitle}</h2>
            <p>{copy.pricingText}</p>
          </div>
          <div className="pricing-preview-grid">
            {pricingPlans.map((plan) => (
              <article key={plan.id} className={plan.featured ? 'is-featured' : undefined}>
                <h3>{plan.name}</h3>
                <p>{plan.summary[locale]}</p>
                <strong>{plan.monthlyUah.toLocaleString(locale === 'uk' ? 'uk-UA' : 'en-US')} <small>{copy.perMonth}</small></strong>
                <Link className={plan.featured ? 'marketing-button' : 'marketing-button marketing-button--secondary'} href={`/register?plan=${plan.id}`}>{copy.planCta}</Link>
              </article>
            ))}
          </div>
          <div className="pricing-preview-link"><Link className="text-link" href={localizedPath(locale, '/pricing')}>{copy.pricingLink} <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="marketing-section marketing-section--light">
        <div className="marketing-shell faq-layout">
          <h2>{copy.faqTitle}</h2>
          <div className="faq-list">
            {copy.faq.map(([question, answer]) => (
              <details key={question}><summary>{question}</summary><p>{answer}</p></details>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-final-cta">
        <div className="marketing-shell marketing-final-cta__inner">
          <div><h2>{copy.finalTitle}</h2><p>{copy.finalText}</p></div>
          <div className="marketing-actions">
            <Link className="marketing-button" href="/register">{site.startFree}</Link>
            <Link className="marketing-button marketing-button--secondary" href={localizedPath(locale, '/demo')}>{site.bookDemo}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

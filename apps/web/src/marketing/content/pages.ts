import type { Locale } from '../routing/locales';

export type ContentPage = {
  title: string;
  description: string;
  sections: Array<{ title: string; body: string; items?: Array<{ title: string; body: string }> }>;
};

export const contentPages: Record<'platform' | 'ai' | 'solutions' | 'about', Record<Locale, ContentPage>> = {
  platform: {
    uk: {
      title: 'Одна платформа для продажів із діалогів',
      description: 'Sales AITO збирає повідомлення, товари, замовлення та контроль менеджера в єдиний робочий процес.',
      sections: [
        { title: 'Від розмови до структурованого замовлення', body: 'AI знаходить у повідомленнях товар, кількість, контакти й дані доставки. Менеджер бачить не хаотичний чат, а готову структуру для перевірки.', items: [
          { title: 'Єдина черга діалогів', body: 'Звернення не губляться між особистими повідомленнями та ручними нотатками.' },
          { title: 'Каталог у контексті', body: 'Система зіставляє запит покупця з вашими товарами та варіантами.' },
          { title: 'Контроль винятків', body: 'Невпевнені розпізнавання залишаються менеджеру, а рутинні кроки автоматизуються.' },
          { title: 'Готові дані', body: 'Підтверджене замовлення переходить у Google Sheets без повторного введення.' },
        ] },
        { title: 'Побудовано для поступової автономності', body: 'Архітектура розширюється на нові канали, поштові служби та взаємодію з постачальниками без зміни основного процесу.' },
      ],
    },
    en: {
      title: 'One platform for sales that start in conversations',
      description: 'Sales AITO brings messages, products, orders and manager control into one workflow.',
      sections: [
        { title: 'From conversation to structured order', body: 'AI finds the product, quantity, contacts and delivery details in a message. The manager reviews a clear order instead of deciphering a chat.', items: [
          { title: 'One conversation queue', body: 'Enquiries no longer disappear between direct messages and manual notes.' },
          { title: 'Catalogue context', body: 'The system matches buyer intent to your products and variants.' },
          { title: 'Exception control', body: 'Uncertain recognition stays with a manager while routine steps are automated.' },
          { title: 'Ready data', body: 'A confirmed order moves to Google Sheets without duplicate entry.' },
        ] },
        { title: 'Built for progressive autonomy', body: 'The architecture can add channels, postal services and supplier workflows without replacing the core process.' },
      ],
    },
  },
  ai: {
    uk: {
      title: 'AI-оператор, що доводить звернення до замовлення',
      description: 'Він розуміє контекст, перевіряє дані та залучає людину там, де впевненість недостатня.',
      sections: [
        { title: 'Автоматизація з контрольованою довірою', body: 'Sales AITO не маскує невпевненість. Система показує, що розпізнано, і залишає менеджеру рішення у складних випадках.', items: [
          { title: 'Розуміння повідомлень', body: 'AI дістає ключові дані з природного тексту, а не вимагає від покупця заповнювати форму.' },
          { title: 'Перевірка каталогу', body: 'Товар і варіант зіставляються з актуальним каталогом.' },
          { title: 'Створення замовлення', body: 'Після перевірки система формує структуроване замовлення.' },
          { title: 'Наступний етап', body: 'Автономні відповіді, накладні та повідомлення постачальникам позначені як майбутні можливості.' },
        ] },
      ],
    },
    en: {
      title: 'An AI operator that carries an enquiry into an order',
      description: 'It understands context, validates data and brings in a person when confidence is not high enough.',
      sections: [
        { title: 'Automation with controlled trust', body: 'Sales AITO does not hide uncertainty. It shows what was recognised and leaves difficult decisions to a manager.', items: [
          { title: 'Message understanding', body: 'AI extracts key details from natural language without forcing a buyer through a form.' },
          { title: 'Catalogue validation', body: 'The requested product and variant are matched against the current catalogue.' },
          { title: 'Order creation', body: 'Once reviewed, the system creates a structured order.' },
          { title: 'The next layer', body: 'Autonomous replies, shipping labels and supplier messages are clearly marked as future capabilities.' },
        ] },
      ],
    },
  },
  solutions: {
    uk: {
      title: 'Для команд, у яких продажі починаються в повідомленнях',
      description: 'Sales AITO допомагає власникам і менеджерам social commerce обробляти більше замовлень без пропорційного зростання рутини.',
      sections: [
        { title: 'Коли Sales AITO дає найбільшу цінність', body: 'Платформа створена для бізнесів, де щодня надходить від десяти замовлень і одна людина вже не може надійно тримати весь контекст.', items: [
          { title: 'Instagram-магазини', body: 'Діалоги, каталог і підтвердження замовлень в одному потоці.' },
          { title: 'Команди продажів', body: 'Менше ручного копіювання й зрозумілий стан кожного звернення.' },
          { title: 'Бренди, що ростуть', body: 'Основа для додавання каналів без окремого процесу на кожну соцмережу.' },
          { title: 'Операції з каталогом', body: 'Перевірка товарів і варіантів до створення замовлення.' },
        ] },
      ],
    },
    en: {
      title: 'For teams where sales begin in messages',
      description: 'Sales AITO helps social commerce owners and managers handle more orders without adding the same amount of repetitive work.',
      sections: [
        { title: 'Where Sales AITO creates the most value', body: 'The platform is designed for businesses receiving ten or more daily orders where one person can no longer hold all the context reliably.', items: [
          { title: 'Instagram stores', body: 'Conversations, catalogue and order approval in one flow.' },
          { title: 'Sales teams', body: 'Less manual copying and a clear state for every enquiry.' },
          { title: 'Growing brands', body: 'A foundation for adding channels without a separate process for each network.' },
          { title: 'Catalogue operations', body: 'Product and variant validation before an order is created.' },
        ] },
      ],
    },
  },
  about: {
    uk: {
      title: 'Sales AITO будує автономний операційний шар для продажів',
      description: 'Ми починаємо з реальної проблеми українського social commerce: замовлення є, але їх обробка досі залежить від ручної роботи.',
      sections: [
        { title: 'Наш принцип', body: 'Автоматизація має забирати рутину, не приховуючи ризики. Тому ми спочатку створюємо надійний контрольований процес, а потім підвищуємо автономність.' },
        { title: 'Україна сьогодні, інші ринки завтра', body: 'Перші інтеграції та сценарії враховують український ринок. Мовна й продуктова архітектура вже готова до подальшого міжнародного розширення.' },
      ],
    },
    en: {
      title: 'Sales AITO is building the autonomous operating layer for sales',
      description: 'We start with a practical Ukrainian social commerce problem: orders exist, but processing still depends on repetitive manual work.',
      sections: [
        { title: 'Our principle', body: 'Automation should remove repetitive work without hiding risk. We first build a reliable controlled process, then increase autonomy.' },
        { title: 'Ukraine today, more markets tomorrow', body: 'The first integrations and workflows fit the Ukrainian market. The language and product architecture are ready for international expansion.' },
      ],
    },
  },
};

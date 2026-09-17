import type { Locale } from '../routing/locales';

export const article = {
  slug: 'how-to-automate-instagram-orders',
  uk: { title: 'Як автоматизувати замовлення з Instagram без втрати контролю', description: 'Практична схема переходу від ручної обробки повідомлень до контрольованого AI-процесу.', sections: [
    ['Почніть не з чат-бота, а з процесу', 'Спочатку опишіть, які дані потрібні для замовлення, де живе каталог і в яких випадках рішення має приймати менеджер. Так автоматизація підсилює команду, а не створює новий хаос.'],
    ['З’єднайте діалог із каталогом', 'Назва товару в повідомленні не завжди збігається з артикулом. Система має враховувати варіанти, колір, розмір і доступність, а сумнівні збіги віддавати на перевірку.'],
    ['Вимірюйте завершені замовлення', 'Кількість автоматичних відповідей нічого не говорить про бізнес-результат. Відстежуйте час до підтвердження, частку виправлень і кількість замовлень, які пройшли без повторного введення.'],
  ] },
  en: { title: 'How to automate Instagram orders without losing control', description: 'A practical route from manual message handling to a controlled AI workflow.', sections: [
    ['Start with the process, not a chatbot', 'Define the data required for an order, where the catalogue lives and which decisions must stay with a manager. Automation should strengthen the team instead of creating a new source of chaos.'],
    ['Connect the conversation to the catalogue', 'The product name in a message may not match its SKU. The system needs to handle variants, colour, size and availability, while routing uncertain matches for review.'],
    ['Measure completed orders', 'The number of automated replies does not show business value. Track time to confirmation, correction rate and orders completed without duplicate data entry.'],
  ] },
} as const satisfies { slug: string } & Record<Locale, { title: string; description: string; sections: readonly (readonly [string, string])[] }>;

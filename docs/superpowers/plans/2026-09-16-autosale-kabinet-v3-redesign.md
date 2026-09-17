# План редизайну AutoSale під AutoSale-kabinet-v3

Дата: 2026-09-16

## 1. Мета

Максимально точно відтворити візуальну систему та композицію `AutoSale-kabinet-v3.html` у чинному AutoSale, не втрачаючи наявний функціонал, права доступу, API-контракти, валідацію, аудит та інтеграції.

Редизайн виконується поступово. Спочатку створюється спільна оболонка та дизайн-система, після чого на неї переводяться робочі екрани один за одним. Відсутні модулі отримують демонстраційні сторінки без удаваної робочої логіки.

## 2. Користувач і очікуваний результат

Основний користувач: менеджер або власник Instagram-магазину.

Основна задача: швидко знайти діалог, перевірити сформоване AI замовлення, скоригувати дані, змінити робочий статус і проконтролювати подальшу обробку.

Бізнесовий результат: зменшити час від вхідного повідомлення до перевіреного замовлення, не знижуючи точність, контроль менеджера та надійність інтеграцій.

## 3. Вихідні матеріали

- `C:/Users/User/Downloads/AutoSale-kabinet-v3.html`: головний референс структури кабінету та семи розділів.
- `C:/Users/User/Downloads/AutoSale-ui-kit.html`: джерело станів контролів, форм, кнопок, таблиць, календаря, повідомлень і завантаження.
- `C:/Users/User/AppData/Local/Temp/codex-clipboard-06cf78ee-4dae-4fc0-b225-740e98fdbb7d.png`: desktop-референс дашборду.
- Поточний репозиторій AutoSales.
- Поточний production-інтерфейс `sales-aito.com`, який уже містить більше можливостей, ніж поточна checkout-версія UI у репозиторії.

## 4. Підтверджені факти

- Frontend працює на Next.js 16, React 19 і TypeScript.
- Поточний checkout використовує vanilla CSS у `apps/web/app/globals.css`, без Tailwind або компонентної UI-бібліотеки.
- Робочі маршрути вже існують для діалогів, замовлень, каталогу, команди та налаштувань.
- Поточний production має розширені фільтри замовлень, пагінацію, перемикач мови, сповіщення, профіль і згортання меню.
- PostgreSQL залишається джерелом істини. Google Sheets є проєкцією.
- AI-дані не вважаються довіреними до проходження схеми, каталогу, completeness, duplicate та approval-перевірок.
- Ролі `OWNER` і `MANAGER`, tenant-межі та owner-only дії мають зберегтися.

## 5. Ключове припущення перед стартом реалізації

Production UI випереджає поточний checkout. Перед редизайном потрібно визначити commit або гілку, з якої розгорнуто `sales-aito.com`, і синхронізувати її з робочою гілкою. Інакше редизайн може випадково повернути назад уже реалізовані фільтри, локалізацію, профіль, сповіщення або pagination.

Це блокуючий крок для реалізації, але не для цього плану.

## 6. Цільова інформаційна архітектура

| Маршрут | Стан після першої хвилі | Джерело даних |
|---|---|---|
| `/dashboard` | Точне візуальне відтворення референсу, демонстраційні KPI | Локальні типізовані mock-дані |
| `/conversations` | Реальні діалоги у новому триколонковому layout | Чинний Conversations API |
| `/conversations/[id]` | Реальний чат та пов'язана картка замовлення | Чинний Conversations API |
| `/orders` | Реальна таблиця, пошук, фільтри, статуси та pagination | Чинний Orders API |
| `/orders/[id]` | Реальний review workflow і Sheets status | Чинний Orders API |
| `/catalogue` | Реальна таблиця, пошук, імпорт і редактор | Чинний Catalogue API |
| `/team` | Реальні учасники, запрошення та role guards | Чинний Team API |
| `/settings` | Реальні Instagram, Google та approval settings | Чинні integration/settings API |
| `/onboarding` | Демонстраційна оболонка або лише доступні реальні кроки | Окремий майбутній модуль |

Головний маршрут після входу має вести на `/dashboard`. CTA дашборду відкриває реальний список замовлень, які потребують перевірки.

## 7. Межа між реальним і демонстраційним функціоналом

### Будуємо зараз

- Нову дизайн-систему та спільну оболонку.
- Новий вигляд усіх наявних робочих розділів.
- Демонстраційний дашборд із типізованими fixtures.
- Меню для онбордингу з чесним placeholder-станом або доступними реальними кроками.
- Візуальні оболонки пошуку та сповіщень тільки там, де вже є їхня логіка.
- Повний набір loading, empty, error, disabled, success і permission states.

### Розробляємо окремо після редизайну

- Реальні KPI дашборду.
- Агрегацію виторгу та середнього чека.
- Графік по місяцях.
- Джерела замовлень.
- Реальну чергу AI-перевірки на дашборді, якщо для неї потрібен новий endpoint.
- Глобальний пошук клієнтів, товарів і замовлень.
- Центр сповіщень, якщо backend-подій ще немає.
- Повний функціональний онбординг.

## 8. Дизайн-система

### 8.1 Типографіка

- Основний шрифт: Plus Jakarta Sans через `next/font` або self-hosted font files.
- Основні ваги: 400, 500, 600, 700, 800.
- Числа в KPI і таблицях: `font-variant-numeric: tabular-nums`.
- Один `h1` на сторінку, без пропуску рівнів заголовків.

### 8.2 Основні кольори з референсу

- Brand primary: `#5B52E0`.
- Brand hover: `#4A41C9`.
- Text strong: `#14142B`.
- Text body: `#4E4B66`.
- Text muted: `#6E7191`.
- Text subtle: `#A0A3BD`.
- Canvas: `#F6F7FB`.
- Surface: `#FFFFFF`.
- Brand soft: `#EEECFD`.
- Border: `#E4E4EE`.
- Success: `#15803D` на `#DCFCE7`.
- Warning: перевірити пару з `#FACC15` на WCAG AA, за потреби затемнити текст.
- Destructive: `#DC2626` на `#FEF2F2`.

У React-компонентах використовувати семантичні CSS-токени, а не raw hex.

### 8.3 Геометрія

- Page/card containers: приблизно 18-20 px radius за референсом.
- Inputs і secondary controls: 10-14 px.
- Status badges: 8-10 px, не використовувати pill без потреби.
- Touch target: мінімум 44x44 px.
- Desktop sidebar: близько 216-224 px у розгорнутому стані.
- Content max-width: 1440-1600 px залежно від екрану.

Точні значення зафіксувати після вимірювання DOM референсу під час implementation spike.

### 8.4 Іконки

- Одна SVG-бібліотека на весь продукт, рекомендовано Phosphor або Tabler.
- Однакова товщина stroke.
- Icon-only кнопки завжди мають `aria-label` і tooltip.
- Не використовувати emoji або текстові символи як функціональні іконки.

### 8.5 Motion

- Motion intensity: 2-3 з 10.
- 150-220 ms для hover, focus і відкриття простих елементів.
- Анімувати тільки opacity і transform.
- Підтримати `prefers-reduced-motion`.
- Не додавати GSAP або важку animation-бібліотеку для цього редизайну.

## 9. Цільова компонентна архітектура

Рекомендована структура:

```text
apps/web/src/components/
  app-shell/
    app-shell.tsx
    app-sidebar.tsx
    app-topbar.tsx
    mobile-navigation.tsx
    profile-menu.tsx
    notification-trigger.tsx
  ui/
    button.tsx
    icon-button.tsx
    input.tsx
    select.tsx
    badge.tsx
    card.tsx
    table.tsx
    tabs.tsx
    dialog.tsx
    empty-state.tsx
    error-state.tsx
    skeleton.tsx
    pagination.tsx
  dashboard/
  conversations/
  orders/
  catalogue/
  team/
  settings/
```

Стилі розділити на:

```text
apps/web/app/styles/
  tokens.css
  reset.css
  primitives.css
  shell.css
  utilities.css
  responsive.css
```

Module-specific стилі тримати поруч із модулем або у зрозуміло названих CSS Modules. Не залишати всю систему в одному `globals.css`.

## 10. План реалізації

### Фаза 0. Синхронізація фактичного baseline

Мета: не втратити функції, які вже працюють у production.

Завдання:

1. Визначити production commit або гілку.
2. Порівняти її з поточною гілкою репозиторію.
3. Скласти inventory production-only функцій.
4. Зафіксувати поточні desktop і mobile screenshots для всіх маршрутів.
5. Зафіксувати чинні маршрути, query params, API calls, permission states та analytics events.
6. Додати мінімальні browser smoke-тести для production-only функцій, яких немає в поточних тестах.

Критерій завершення: робоча гілка містить повний актуальний UI-функціонал або документовану сумісну заміну.

### Фаза 1. Reference contract і visual baseline

Мета: перетворити HTML-референси на перевірювану специфікацію.

Завдання:

1. Зняти еталонні screenshots `kabinet-v3` на 1440, 1024, 768 і 375 px.
2. Зафіксувати grid, sidebar width, topbar height, page paddings, card radii, spacing scale, font sizes та states.
3. Витягнути список компонентів з `ui-kit`.
4. Створити visual acceptance checklist для кожного маршруту.
5. Визначити допустиме відхилення screenshot comparison. Рекомендація: не більше 0.5-1.0% pixels після маскування динамічних даних.

Критерій завершення: команда має вимірюваний reference contract, а не лише скріншот для наслідування.

### Фаза 2. Foundations і дизайн-токени

Мета: створити спільну основу без зміни бізнес-логіки.

Завдання:

1. Підключити Plus Jakarta Sans.
2. Створити semantic color, spacing, type, radius, shadow і z-index tokens.
3. Реалізувати Button, IconButton, Input, Select, Badge, Card, Tabs, Dialog, Table primitives.
4. Додати focus-visible, hover, active, disabled і pending states.
5. Реалізувати Skeleton, EmptyState, ErrorState і inline validation.
6. Додати SVG icon system.
7. Додати component tests для variant states та accessible names.

Критерій завершення: primitives відтворюють `ui-kit`, не містять бізнес-логіки та проходять accessibility checks.

### Фаза 3. AppShell і навігація

Мета: відтворити каркас `kabinet-v3` для всіх authenticated pages.

Завдання:

1. Реалізувати `AppShell`, sidebar і topbar.
2. Додати пункти Dashboard, Діалоги, Замовлення, Каталог, Команда, Налаштування, Онбординг.
3. Зберегти role-based visibility.
4. Перенести profile menu, logout, language switch і notifications trigger з актуального production baseline.
5. Додати skip link та `main` landmark.
6. Реалізувати desktop, tablet і mobile navigation.
7. Замінити окремі page layouts на спільний shell без зміни внутрішнього контенту.

Критерій завершення: усі маршрути відкриваються у новій оболонці, активний пункт правильний, keyboard focus не губиться.

### Фаза 4. Демонстраційний dashboard

Мета: точно відтворити референсний dashboard без вигаданого backend.

Завдання:

1. Додати `/dashboard` і зробити його post-login landing page.
2. Реалізувати AI queue hero, KPI cards, monthly chart, source donut і review queue.
3. Винести mock data в окремий типізований fixture.
4. Додати непомітний, але однозначний маркер demo data для власника продукту або development mode.
5. CTA черги має вести до реального `/orders` із наявним або майбутнім `status=NEEDS_REVIEW` filter.
6. Не підключати фальшиві API та не змішувати mock values з production data layer.

Критерій завершення: dashboard візуально відповідає референсу, але не вводить користувача в оману щодо джерела KPI.

### Фаза 5. Діалоги

Мета: перенести найважливіший робочий сценарій у новий дизайн.

Завдання:

1. Адаптувати `InboxShell`, `ConversationList` і `MessageThread` до нового shell.
2. Відтворити список діалогів, active state, unread state, timestamps, avatar fallback і довгі імена.
3. Зберегти реальний пошук, якщо він є в production baseline.
4. Відтворити чат, message grouping, attachments і composer disabled/active states.
5. Показувати реальну AI order card, якщо замовлення існує.
6. Зберегти empty state для неактивного діалогу.
7. На tablet і mobile зробити list-detail flow замість чотирьох одночасних колонок.

Критерій завершення: існуючі e2e сценарії діалогу працюють, довгі повідомлення та вкладення не ламають layout.

### Фаза 6. Замовлення і review flow

Мета: перенести production-таблицю та редагування без регресій.

Завдання:

1. Зберегти production search, filters, sorting і pagination.
2. Перенести таблицю в стиль референсу.
3. Зберегти всі реальні статуси order, fulfillment, shipment і Sheets export.
4. На mobile перемикатися на summary cards або горизонтально контрольований table mode.
5. Переробити `OrderReviewPanel` на секції з чіткою ієрархією.
6. Зберегти блокування approve при unresolved validation issues.
7. Зберегти save, approve, cancel і retry Sheets states.
8. Додати confirmation для destructive/final actions там, де це потрібно.

Критерій завершення: manager може виконати весь чинний review workflow, а API payloads не змінилися.

### Фаза 7. Каталог

Мета: перенести робочу таблицю, імпорт і редагування товарів.

Завдання:

1. Зберегти пошук, sorting, pagination і owner-only actions.
2. Відтворити catalogue table зі статусами, ціною, залишком та діями.
3. Зберегти desktop table і mobile cards.
4. Перенести import wizard і source health states.
5. Перенести `ProductEditor` у доступний dialog або side panel з focus trap.
6. Не змінювати SKU, aliases, catalogue mapping або import contracts.

Критерій завершення: власник може імпортувати, створити й відредагувати товар, менеджер бачить лише дозволені дії.

### Фаза 8. Команда

Мета: відтворити reference layout для team management.

Завдання:

1. Зробити двоколонкову desktop-композицію invite form і user list.
2. Зберегти invitations, revoke та block workflows.
3. Замінити `window.confirm` на доступний confirmation dialog.
4. Показувати статус текстом та іконкою, не лише кольором.
5. Зберегти owner-only route guard і UI visibility.

Критерій завершення: права доступу та всі team mutations збігаються з baseline.

### Фаза 9. Налаштування

Мета: перенести integration settings у reference tabs/cards.

Завдання:

1. Реалізувати вкладки Соцмережі, Дані та Замовлення.
2. Зберегти deep links через query або hash.
3. Перенести Instagram connection summary і owner actions.
4. Перенести Google Sheets connection, catalogue sources і health states.
5. Перенести approval policy та demo scenario.
6. Зберегти manager read-only mode.
7. Додати pending, reconnect, disconnected, failed і retry states.

Критерій завершення: OAuth, reconnect/disconnect, settings save і role restrictions не змінили поведінку.

### Фаза 10. Auth, onboarding і службові сторінки

Мета: завершити цілісність продукту.

Завдання:

1. Стилізувати login, register, invite, reset і verify screens у тій самій системі.
2. Додати branded 404 і загальні error boundaries.
3. Зберегти legal routes і тексти.
4. Додати `/onboarding` як demo або partial-functional page із чіткими доступними кроками.
5. Не створювати dead-end buttons.

Критерій завершення: authenticated і unauthenticated частини виглядають як один продукт.

### Фаза 11. Visual QA, accessibility і hardening

Мета: прийняти редизайн не за суб'єктивним відчуттям, а за доказами.

Завдання:

1. Screenshot comparison на 375, 768, 1024, 1440 і 1920 px.
2. Keyboard walkthrough усіх primary flows.
3. Accessibility tree і axe checks.
4. Contrast checks для тексту, badges, кнопок і charts.
5. Long-content, empty, loading, error, disabled та slow-network states.
6. Перевірка console і network errors.
7. Lighthouse baseline для ключових маршрутів.
8. Перевірка відсутності layout shift від шрифту, avatar і charts.
9. Повний regression run: unit, component, typecheck, build і Playwright.

Критерій завершення: acceptance checklist виконано, known visual deviations задокументовані й погоджені.

## 11. Тестова стратегія

### Component tests

- AppShell active navigation і role-based visibility.
- Button/Input/Select/Badge variants.
- Empty, error, loading і permission states.
- Order status mapping.
- Form validation і pending states.
- Dialog focus management.

### Integration tests

- Server page отримує дані й передає їх presentation components.
- Query params зберігають filter, sort і pagination state.
- Owner і manager бачать різні controls.
- Mock dashboard не викликає production analytics endpoints.

### E2E tests

- Login відкриває dashboard.
- Dashboard CTA відкриває review queue.
- Відкрити діалог, прочитати повідомлення, побачити order card.
- Знайти і відфільтрувати замовлення.
- Відредагувати та підтвердити order draft.
- Повторити failed Sheets export.
- Знайти, створити й відредагувати товар.
- Запросити та відкликати менеджера.
- Перевірити owner і manager settings.
- Mobile navigation та back flow.

### Visual regression

- Mask dynamic names, timestamps і counts.
- Окремі snapshots для desktop, tablet і mobile.
- Окремі snapshots для normal, empty, loading і error states.

## 12. Критерії приймання

1. Усі authenticated сторінки використовують один AppShell.
2. Візуальна система відповідає `AutoSale-kabinet-v3` і `AutoSale-ui-kit`.
3. Існуючі маршрути та API payloads не змінені без окремого рішення.
4. Production-only функції не втрачені.
5. Dashboard demo data повністю ізольовані від real data layer.
6. OWNER і MANAGER permissions збережені.
7. Усі інтерактивні елементи доступні з клавіатури.
8. Немає горизонтального scroll на 375 px, крім явно контрольованого table viewport.
9. Loading, empty, error, success, disabled і read-only states оформлені.
10. Немає console errors, app-origin warnings або failed network requests у happy path.
11. `pnpm test`, `pnpm typecheck`, `pnpm build` і Playwright suite проходять.
12. Ключові сторінки перевірені на 375, 768, 1024, 1440 і 1920 px.

## 13. Ризики і зменшення ризику

| Ризик | Наслідок | Запобіжний захід |
|---|---|---|
| Production випереджає checkout | Втрата вже готових функцій | Фаза 0 перед будь-яким UI rewrite |
| Big-bang заміна layout | Великі та важкі для пошуку регресії | Вертикальні зрізи по маршрутах |
| Один глобальний CSS-файл | Конфлікти та cascade regressions | Tokens, primitives, shell, modules |
| Mock dashboard виглядає як real analytics | Хибні управлінські рішення | Ізольовані fixtures і явний demo contract |
| Reference desktop-first | Слабкий mobile UX | Окремі mobile flows, а не просте стискання desktop |
| Декоративні status colors | Недоступність і неоднозначність | Текст, іконка, semantic label і contrast check |
| Нова UI-бібліотека | Bundle, style conflicts, migration cost | Почати з власних primitives у чинному stack |
| Редизайн змінює API або domain logic | Функціональні регресії | Presentation-only contracts і regression tests |
| Дуже точний screenshot match шкодить реальним даним | Truncation або приховані controls | Реальні дані й права мають пріоритет над декором |

## 14. Рекомендований порядок pull requests

1. `ui/foundation-tokens-primitives`
2. `ui/app-shell-navigation`
3. `ui/dashboard-demo`
4. `ui/conversations-redesign`
5. `ui/orders-redesign`
6. `ui/catalogue-redesign`
7. `ui/team-redesign`
8. `ui/settings-redesign`
9. `ui/auth-onboarding-service-pages`
10. `ui/visual-a11y-hardening`

Кожен PR має бути deployable, проходити regression suite і не залишати одночасно дві конкуруючі оболонки для одного маршруту.

## 15. Окремий roadmap після візуального редизайну

### Реальний dashboard

Потрібно окремо визначити:

- точне визначення виторгу;
- валюту та правила конвертації;
- що вважається замовленням;
- що входить у середній чек;
- часовий пояс і межі періодів;
- джерело attribution для Direct, Comments, Stories і Manual;
- endpoint для review queue;
- permissions і tenant isolation;
- event history або materialized aggregates;
- baseline і цільові KPI.

### Глобальний пошук

Потрібен окремий індекс або агрегований endpoint для клієнтів, товарів і номерів замовлень. До цього search field у topbar має бути disabled або мати чесний локальний scope.

### Сповіщення

Потрібно визначити event types, read/unread state, retention, delivery channel і permission model.

### Онбординг

Потрібен окремий продуктовий flow із progress persistence, resume behavior, owner-only steps та інтеграційними перевірками.

## 16. Підсумкова рекомендація

Реалізовувати редизайн як поступову точну міграцію, а не як одночасний rewrite і не як просте перевизначення CSS. Спочатку синхронізувати production baseline, потім створити reference contract і AppShell, після чого переносити робочі сценарії від найбільш критичного до менш критичного: діалоги, замовлення, каталог, команда, налаштування.

Dashboard слід додати рано як демонстраційну сторінку, але реальну аналітику залишити окремим продуктово-технічним проєктом.


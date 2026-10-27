# Meta App Review для Sales AITO

Цей документ фіксує стан заявки Meta та відтворюваний сценарій перевірки.
Секрети Meta, Instagram-токени й облікові дані реальних клієнтів сюди не
додаються.

## Поточний стан

- Meta app `AutoSale` опублікований.
- **App Review подано 2026-10-27**: Meta показує **Review in progress** для
  `instagram_business_basic` і `instagram_business_manage_messages` у
  [заявці AutoSale](https://developers.facebook.com/apps/1361315439512963/app-review/submissions/feedback/?submission_id=1361506322827208).
  2026-10-26 зайві Facebook, comments, `public_profile` і `Human Agent`
  вилучено з цієї заявки,
  щоб не затримувати доступ до основних Instagram DM. Це не змінює вже
  надані дозволи застосунку; семиденна ручна відповідь потребуватиме
  окремої заявки на `Human Agent`.
- Звичайні відповіді Send API доступні у 24-годинному вікні. Окремий live-тест
  2026-10-02 довів, що `HUMAN_AGENT` для ручної відповіді до 7 днів ще не
  надано: Meta повернув HTTP 403 / code 10 при справному token та recipient
  access. Це окремий App Review / business verification gate, а не причина
  перепідключати Instagram.
- Повторний дозволений тест 2026-10-15 у діалозі тестового акаунта віком понад
  24 години також завершився `INSTAGRAM_HUMAN_AGENT_UNAVAILABLE`. Sales AITO
  показав окрему помилку, а після перезавантаження зберіг статус невдалої
  доставки; успішного надсилання цим тестом не підтверджено. Доступ Meta до
  `Human Agent` лишається зовнішньою передумовою.
- 2026-10-02 застосунок незворотно позначено в Meta як **Tech Provider**, що
  відповідає моделі Sales AITO: сервіс обробляє Instagram-дані компаній-клієнтів.
- 2026-10-26 Meta прийняла іконку 1024×1024 з
  [`assets/sales-aito-meta-icon-1024.png`](assets/sales-aito-meta-icon-1024.png)
  без редизайну; App settings у заявці показує 100%.
- Обидва описи дозволів, підтвердження дозволеного використання й два
  screencast подано; **Allowed usage показувало 100%** перед поданням.
  Meta ще не повідомила рішення щодо достатності цих відео.
- 2026-10-27 Meta підтвердила Business verification для ФОП Швець Ігор
  Олександрович у портфоліо `AutoSale`. У Meta Developers вона відображається
  як **Verified**. Це ще не надає Instagram Advanced Access клієнтам.
- 2026-10-27 окрему **Access verification** для Tech Provider подано з описом
  Sales AITO як SaaS-платформи. Її стан — **In review**; Meta вказує, що
  звернеться протягом п'яти днів, якщо потрібні додаткові відомості.
- Налаштовано HTTPS OAuth callback, webhook, deauthorization callback і data
  deletion callback.
- Webhook успішно пройшов verification і тест поля `messages`.
- Додано платформу Website з публічним URL AutoSale.
- У reviewer instructions зазначено, що Sales AITO використовує власний вхід
  за email/паролем і не інтегрує Facebook Login. 2026-10-26 застарілий
  тимчасовий URL входу замінено на `https://sales-aito.com/login`, а опис
  навігації й тесту виправлено. Самі reviewer credentials після цього ще не
  перевірено в окремій браузерній сесії.
- Створено окремий активний AutoSale workspace для Meta reviewer. Його
  credentials передано лише в заявці Meta App Review, не в Git.
- **Data handling завершено й подано 2026-10-27.** До Meta внесено
  `OpenAI, OpCo, LLC`, `Google LLC` і `Cloudflare, Inc.` як постачальників
  IT-послуг. Географію обробки взято з чинних публічних переліків для OpenAI
  API, Google Workspace та глобальної мережі Cloudflare; для Cloudflare
  враховано країни опублікованих датацентрів, а не лише країну реєстрації.
  Контролер указаний як ФОП Швець Ігор Олександрович (Україна); відповідь
  про відсутність запитів національної безпеки за 12 місяців підтверджена
  власником раніше. Політики реагування на такі запити не декларувалися,
  бо затвердженого документа не знайдено. Першоджерела:
  [OpenAI](https://openai.com/policies/sub-processor-list/),
  [Google Workspace](https://workspace.google.com/intl/en/terms/subprocessors/) і
  [Cloudflare](https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/).
  Публічні переліки охоплюють можливі місця обробки й підтримки, тому
  географія в декларації ширша за місця фактично підтверджених запитів.
  Після фінального підтвердження власником Meta Platform Terms / Developer
  Policies заявка перейшла у **Review in progress**. Це не означає, що
  Advanced Access уже схвалено.
- `https://sales-aito.com/login`, `/privacy`, `/privacy/data-deletion` і
  `/terms` повернули HTTP 200 під час перевірки 2026-10-26.

## Що перевірити під час review

1. Відстежити окрему Access verification для Tech Provider: вона **In review**.
2. Meta може попросити окремий публічний Instagram Professional test account,
   який проходить OAuth без помилки ролі й доступний reviewer.
3. Перевірити, чи обидва завантажені screencast достатньо чітко показують
   повний сценарій для reviewer; факт завантаження не означає схвалення Meta.
4. Reviewer instructions і Allowed usage показували 100% перед поданням,
   але тестовий вхід ще не перевірено незалежно в браузері. На запит Meta
   надати відтворювані кроки без передавання клієнтських паролів.
5. Стежити за статусом **Review in progress** і відповідати на конкретні
   запити Meta. Подану заявку не можна редагувати чи скасувати під час review.
6. Якщо пізніше подавати `Human Agent` окремо, у screencast показати саме
   ручну дію менеджера у діалозі віком 24 години–7 днів; автоматичні або
   AI-відповіді не можна обґрунтовувати цим feature.

Для reviewer використовуйте чинний стабільний домен `sales-aito.com` і
перевірте його доступність перед поданням. Тимчасові `trycloudflare.com` URL
не підходять як постійні reviewer-посилання.

## Сценарій screencast

Запис має бути без монтажних розривів, із видимим URL браузера. Не показуйте
паролі, app secret, access token, verify token або `.env`.

### `instagram_business_basic`

1. Відкрити публічний `/login` і ввійти тестовим Sales AITO reviewer account.
2. Перейти в **Налаштування → Соцмережі / клієнти → Instagram**.
3. Натиснути **Підключити Instagram**.
4. Авторизувати окремий Instagram Professional test account.
5. Повернутися в Sales AITO й показати картку інтеграції з активним статусом,
   Instagram username та account ID.
6. Пояснити, що permission потрібен для ідентифікації підключеного акаунта і є
   залежністю для `instagram_business_manage_messages`.

### `instagram_business_manage_messages`

1. Почати з уже підключеного Instagram Professional test account.
2. З іншого Instagram-акаунта надіслати одне тестове повідомлення із простим
   замовленням.
3. В AutoSale відкрити список діалогів і показати отримане повідомлення.
4. В AutoSale надіслати одну текстову відповідь і показати, що вона з’явилася
   в Instagram та рівно один раз у діалозі AutoSale.
5. Показати розпізнані поля замовлення та опціональний manager approval.
6. Не показувати Google Sheets як причину доступу до Meta: це downstream дія
   AutoSale, а permission використовується саме для отримання DM.

## Текст для обґрунтування дозволів

Для `instagram_business_basic` пояснити, що AutoSale отримує лише ідентичність
професійного акаунта, показує її власнику workspace та використовує цей scope
як обов'язкову залежність доступу до повідомлень.

Для `instagram_business_manage_messages` пояснити, що AutoSale отримує вхідні
DM бізнесу, дозволяє менеджеру відповідати на них через офіційний Send API,
маршрутизує діалоги лише в його tenant і перетворює підтверджені замовлення на
структуровані записи. Дані інших tenant недоступні
ані клієнту, ані platform admin.

## Фінальна перевірка

- [x] App icon прийнято Meta; App settings показує 100%.
- [x] AutoSale позначено як Tech Provider.
- [x] Подану заявку скорочено до двох Instagram permissions.
- [x] Business verification схвалено Meta (2026-10-27).
- [ ] Access verification для Tech Provider схвалено (подана 2026-10-27,
  зараз **In review**).
- [ ] Reviewer credentials працюють у приватному вікні браузера.
- [ ] OAuth завершується для окремого Professional test account.
- [ ] Картка інтеграції показує правильний username.
- [ ] Реальний DM потрапляє в правильний tenant.
- [x] Обидва screencast завантажені й перевірені на видимі секрети; достатність
  демонстрації ще оцінить Meta.
- [x] Privacy, Terms і Data deletion URL повертають HTTP 200 (2026-10-26).
- [x] У заявці немає permissions, які продукт не використовує.
- [ ] Окремий Human Agent access схвалено й одна ручна відповідь у діалозі віком
  24 години–7 днів отримала `SENT` без повторного повідомлення.
- [ ] Публічний домен залишатиметься активним протягом усього review.
- [x] Data handling заповнено, згоду з умовами Meta підтверджено й заявку
  подано; статус **Review in progress** перевірено 2026-10-27.

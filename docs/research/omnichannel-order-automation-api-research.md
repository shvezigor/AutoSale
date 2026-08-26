# API-дослідження: збір замовлень із чатів і передача в облік/доставку

**Дата перевірки:** 2026-08-26  
**Обсяг:** Instagram, Telegram, Viber, TikTok, OLX, Нова пошта, n8n, Excel/Google Sheets.  
**Метод:** лише офіційні або первинні джерела. Де документація не підтверджує продуктову гарантію, це позначено як **висновок**, а не факт.

## Короткий висновок

Для першого клієнта технічно найкращий порядок каналів: **Instagram Professional → Telegram → OLX → Viber → TikTok**. Нова пошта придатна для повного створення ЕН/ТТН через офіційний API. Google Sheets добре підходить як тимчасовий операційний інтерфейс; локальний `.xlsx` — слабка «база даних» для конкурентних записів.

**Рекомендована конструкція:** n8n як оркестратор інтеграцій і MVP, але канонічні замовлення, ідемпотентність, аудит, зіставлення номенклатури та правила статусів — у власному сервісі з PostgreSQL. Це гібрид, а не вибір «n8n або backend».

## Порівняльна таблиця

| Канал | Вхідні повідомлення | Відповідь API | Медіа | Головна умова/обмеження | Придатність |
|---|---:|---:|---:|---|---|
| Instagram | Webhooks + Conversations API | Так | Так, але для share повертається лише URL | Лише Professional (Business/Creator); Advanced Access для чужих акаунтів; стандартне вікно 24 год | Висока |
| Telegram | Webhook або long polling | Так | Так | Бот бачить взаємодії з ботом, а не приватні чати звичайного акаунта; updates зберігаються до 24 год | Дуже висока |
| Viber | Webhook | Так | Текст, picture, video, contact, URL, location | Нові боти з 05.02.2024 лише комерційні; користувач має взаємодіяти/підписатися | Середня |
| TikTok | Business Messaging API + webhooks | Так | Завантаження/вивантаження image/video передбачене API | Потрібен Business-доступ, авторизація та security/privacy review; доступність/регіон треба підтвердити до оцінки | Середня, з ризиком доступу |
| OLX.ua | Threads/messages REST API; polling (webhook чатів у схемі не підтверджено) | Так | Залежить від Message schema/доступу | OAuth/Partner API, реєстрація застосунку; треба перевірити квоти й production approval | Висока після доступу |

## 1. Instagram Messaging API (Meta)

### Підтверджені факти

- Instagram API with Instagram Login працює для **Instagram Professional accounts** (Business і Creator). Для повідомлень потрібні `instagram_business_basic` та `instagram_business_manage_messages`. Офіційна колекція Meta: [Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
- Send API дозволяє професійному акаунту надсилати й отримувати повідомлення; розмова починається, коли Instagram-користувач першим звертається до бізнесу. Вхідні події приходять у webhook після підписки на `messages`/`messaging_postbacks`: [Meta Instagram Send API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-af579d08-121e-4897-8f45-5fd41ace49df).
- Conversations API повертає список розмов, повідомлення, час і відправника. Для акаунтів, які застосунок не володіє/не адмініструє, потрібен **Advanced Access**; для власних тестових акаунтів можливий Standard Access. Неактивні понад 30 днів розмови в Requests не повертаються: [Meta Conversations API](https://www.postman.com/meta/instagram/folder/23987686-6a91368f-1fa8-4614-9ed6-7d1e08c21e62).
- Для shared post/media API або webhook містить лише URL зображення/відео; це треба одразу завантажити або поставити в чергу обробки: [Meta Conversations API limitations](https://www.postman.com/meta/instagram/folder/23987686-6a91368f-1fa8-4614-9ed6-7d1e08c21e62).
- Стандартне вікно відповіді — 24 години. `HUMAN_AGENT` за окремим permission дозволяє людині відповідати до 7 днів, але **не дозволяє автоматизовані повідомлення**: [Meta Send API / HUMAN_AGENT](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-af579d08-121e-4897-8f45-5fd41ace49df).

### Висновки для системи

- Це найреалістичніший перший вхідний канал, якщо клієнт уже має Business/Creator account.
- Фраза менеджера «дякуємо, беремо замовлення в роботу» може бути тригером, але надійніше використовувати status action/кнопку або підтвердження в операторському UI: фрази змінюються, редагуються й можуть повторюватися.
- Для SaaS на багато клієнтів Meta App Review/Advanced Access, token lifecycle, webhook verification і tenant-level permissions — окрема продуктова робота.

## 2. Telegram Bot API

### Підтверджені факти

- Bot API — HTTP API; оновлення отримуються взаємовиключно через `getUpdates` (long polling) або `setWebhook`. Неполучені updates зберігаються не довше 24 годин: [Telegram Bot API — Getting updates](https://core.telegram.org/bots/api#getting-updates).
- Webhook надсилає HTTPS POST і повторюється при не-2xx; `secret_token` дає заголовок `X-Telegram-Bot-Api-Secret-Token`: [Telegram `setWebhook`](https://core.telegram.org/bots/api#setwebhook).
- API підтримує повідомлення й файли; файл отримується через `getFile`: [Telegram Bot API](https://core.telegram.org/bots/api#getfile).
- n8n має офіційні вбудовані Telegram action і trigger nodes: [n8n Telegram node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/) та [n8n Telegram Trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/).

### Висновки для системи

- Telegram — найпростіший канал для нотифікацій постачальнику/менеджеру та human approval.
- Бот не є способом «читати всі приватні чати менеджера». Замовлення мають надходити самому боту, у групу/канал, де він присутній і має потрібні права, або з іншої офіційної бізнес-інтеграції.
- Для постачальника краще надсилати структуровану картку із кнопками `Підтвердити / Немає / Уточнити`, а не лише текст.

## 3. Viber Bot API

### Підтверджені факти

- Viber REST Bot API приймає вхідні події через webhook та підтримує text, picture, video, contact, URL, location; `file` має окремі обмеження: [Viber REST API](https://developers.viber.com/docs/api/rest-bot-api/).
- З 5 лютого 2024 року нові Viber bots створюються лише на комерційних умовах через Viber/офіційних партнерів: [Viber REST API — Important notes](https://developers.viber.com/docs/api/rest-bot-api/).
- Немає API для отримання всіх subscriber IDs; їх треба зберігати з callbacks. Перший меседж користувача підписує його. Для ініціювання повідомлень за номером телефону Viber пропонує окремі Business Messages через партнерів: [Viber REST API](https://developers.viber.com/docs/api/rest-bot-api/).

### Висновки для системи

- Технічно інтеграція нормальна, але комерційний onboarding робить її дорожчою й повільнішою за Telegram.
- Не планувати «підключити особистий Viber менеджера і читати його чати» через Bot API; канал треба перевести в офіційний chatbot/Business Messages сценарій.
- У n8n немає підтвердженого нами first-party Viber node; REST API викликається через HTTP Request/webhook.

## 4. TikTok

### Підтверджені факти

- TikTok for Business документує **Business Messaging API**: список розмов і повідомлень, send message, upload/download media, webhook configuration, automatic messages та conversation capability check: [TikTok API for Business documentation](https://ads.tiktok.com/gateway/docs/index?doc_id=1751443956638721&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH).
- Доступ проходить окремий процес: Business Messaging API access, authorization/authentication, data security/privacy review; у документації є окремі messaging limits: [TikTok Business Messaging API index](https://ads.tiktok.com/gateway/docs/index?doc_id=1740050161973250&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH).
- Business Center дозволяє операторам працювати з direct messages; для частини ринків потрібен Verified Business Account: [TikTok account integration with Business Center](https://ads.tiktok.com/help/article/business-account-integration-with-business-center?lang=en).
- Автовідповіді (welcome, keyword reply, suggested questions, chat prompts) доступні для Advanced Access + Verified Business Account, не General account: [TikTok automatic messages](https://ads.tiktok.com/help/article/navigate-auto-message-business-accounts?lang=en).
- Окремий Data Portability API може експортувати direct messages за згодою користувача, але це механізм перенесення архіву, а не real-time customer-support inbox: [TikTok Data Portability API](https://developers.tiktok.com/docs/en/data-portability-api-get-started).

### Висновки для системи

- TikTok уже не слід автоматично відкидати як «API чатів немає»: Business Messaging API офіційно існує.
- Але до включення в MVP треба письмово підтвердити доступність API для конкретної компанії/регіону (Україна), вимоги verification і фактичні messaging limits. Це gate, а не звичайна задача розробки.
- У n8n немає підтвердженого first-party Business Messaging node; використовувати webhooks + HTTP Request після approval.

## 5. OLX Україна Partner API

### Підтверджені факти

- OLX має офіційний Developer Portal з реєстрацією застосунку й OAuth: [OLX Developer Portal](https://developer.olx.ua/en).
- Актуальна первинна OpenAPI-схема містить `GET /threads`, `GET /threads/{threadId}`, `GET /threads/{threadId}/messages` і `POST /threads/{threadId}/messages`: [OLX Partner API OpenAPI YAML](https://developer.olx.ua/swagger/v2/partner_api.yaml).
- Схема також містить оголошення, користувачів, довідники категорій/локацій тощо, тож повідомлення можна зв’язувати з `advert_id` і каталогом OLX: [OLX Partner API schema](https://developer.olx.ua/swagger/v2/partner_api.yaml).

### Висновки для системи

- Для чатів доступний офіційний шлях; браузерний scraping не потрібен і не рекомендується.
- У перевіреній схемі ми підтвердили REST endpoints, але не підтвердили webhook для нового повідомлення. Отже, початковий дизайн — інкрементальний polling із дедуплікацією за message/thread ID, доки OLX не підтвердить webhook іншою документацією.
- Потрібно до оцінки отримати production credentials і перевірити rate limits/договірні умови. В n8n first-party OLX node не підтверджено; викликати API через HTTP Request.

## 6. Нова пошта API 2.0

### Підтверджені факти

- Офіційна сторінка прямо заявляє: API може автоматично створювати й зберігати електронні накладні, рахувати вартість, трекати статуси, друкувати маркування, змінювати ЕН і замовляти переадресацію/повернення: [Нова пошта — можливості інтеграції](https://novaposhta.ua/for-business/cooperation/integration/).
- Офіційні entrypoints: `https://api.novaposhta.ua/v2.0/json/` і `/xml/`, HTTPS GET/POST. API key створюється безкоштовно в бізнес-кабінеті: [Нова пошта — інтеграція](https://novaposhta.ua/for-business/cooperation/integration/).
- Детальний developer portal: [Nova Poshta API 2.0](https://developers.novaposhta.ua/).

### Висновки для системи

- Повне створення ТТН/ЕН і повернення номера клієнту — реалістичний офіційний сценарій.
- Не створювати ЕН лише на основі AI-витягу без перевірки обов'язкових полів. Мінімально валідовувати телефон, ПІБ, населений пункт/warehouse ref або точну адресу, тип доставки, вагу/місця, оголошену вартість, платника й післяплату.
- Зберігати `order_id ↔ Ref/IntDocNumber`, сирий request/response, статус і помилки; повторний запуск не повинен створювати дубль ТТН.
- У n8n first-party Nova Poshta node не підтверджено; API легко викликається HTTP Request node, але бізнес-правила та ідемпотентність краще тримати у backend.

## 7. n8n та таблиці

### Підтверджені факти

- n8n має built-in Telegram action/trigger nodes: [Telegram node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/).
- n8n має Facebook Trigger з Instagram events і Facebook Graph API node/credentials: [Facebook Trigger — Instagram](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.facebooktrigger/instagram/) та [Facebook Graph API node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.facebookgraphapi/).
- n8n має Google Sheets node і Google Sheets Trigger: [Google Sheets](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/) та [Google Sheets Trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.googlesheetstrigger/).
- Для будь-якого REST API доступний HTTP Request node, а generic Webhook node приймає callbacks: [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/) і [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/).
- Microsoft Excel у практичній інтеграції n8n спирається на Microsoft 365/OneDrive/Graph; n8n має OneDrive node, але прямий локальний `.xlsx` не є транзакційним datastore: [Microsoft OneDrive node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftonedrive/).

### Висновки: n8n чи власний сервіс

| Критерій | n8n | Власний сервіс | Гібрид |
|---|---|---|---|
| Швидкий MVP | Сильний | Повільніший | Сильний |
| Webhooks/API glue | Сильний | Можливо, але більше коду | n8n |
| Складний стан замовлення | Слабший | Сильний | backend |
| Ідемпотентність/конкурентність | Потребує дисципліни | Контрольована | backend |
| AI matching, версії prompt/model | Можливо, але workflow швидко ускладнюється | Сильний | backend |
| Human approval | Зручно через Telegram/Wait | Треба UI | n8n спочатку |
| Multi-tenant SaaS | Незручно як єдина основа | Сильний | backend + tenant-aware connectors |
| Спостережуваність/повтор | Є execution history | Повний контроль | обидва |

**Рекомендація:**

1. n8n приймає webhooks/polling, завантажує media, викликає backend і доставляє Telegram notifications.
2. Backend нормалізує `InboundMessage`, накопичує контекст розмови, визначає момент підтвердження, запускає AI extraction/product matching, валідує та створює `Order`.
3. PostgreSQL — source of truth. Таблиця — проєкція/операторський інтерфейс, не єдина база.
4. Інтеграція таблиці записує стабільний `order_id`, channel, conversation/message IDs, customer, SKU, qty, confidence, delivery data, status, TTN, timestamps.
5. Низька впевненість або неоднозначний SKU → Telegram approval/черга ручної перевірки. Створення ТТН — лише після підтвердження даних.

## 8. Рейтинг придатності для першого MVP

1. **Instagram + Google Sheets + Telegram + backend/Postgres + n8n** — найкраще відповідає описаному процесу.
2. **Нова пошта** — додати після стабілізації extraction/validation, але архітектурно передбачити одразу.
3. **OLX** — хороший другий sales channel після отримання Partner API production access; почати з polling.
4. **Viber** — лише якщо клієнт готовий до комерційного chatbot onboarding.
5. **TikTok** — technical spike після підтвердження Business Messaging access у регіоні.

## 9. Перевірки до оцінки розробки

- Професійний статус Instagram акаунта, ownership у Meta Business, можливість App Review/Advanced Access.
- Чи замовлення приходять у bot/business inbox, а не в особисті Telegram/Viber акаунти.
- OLX application approval, scopes, quota/rate limits і тест реального `/threads`.
- TikTok region eligibility, Verified Business Account, Business Messaging API approval і limits.
- Реальний шаблон Excel/Google Sheet, унікальні SKU/aliases, якість фото та 100–300 анонімізованих переписок для evaluation.
- API key Нової пошти, дані відправника, типи доставки/оплати, правила післяплати й тестовий процес скасування дубльованої ЕН.

## Рівень певності

- **Високий:** Telegram, Viber commercial rule, Instagram Professional/permissions/webhooks/24h, OLX thread endpoints, Nova Poshta API entrypoints/capabilities.
- **Середній:** конкретний n8n Instagram event coverage слід перевірити на живому Meta app; generic webhook/HTTP API шлях точно доступний.
- **Потребує vendor confirmation:** TikTok Business Messaging eligibility для українського бізнесу та конкретні limits; OLX production quotas/webhook availability; комерційна ціна Viber.

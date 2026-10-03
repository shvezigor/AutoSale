# API-дослідження: збір замовлень із чатів і передача в облік/доставку

**Дата перевірки:** 2026-10-03

**Обсяг:** Meta Business Verification для українського ФОП, Instagram, Facebook Page Messenger, Threads, Telegram, Viber, TikTok, OLX, Нова пошта, n8n, Excel/Google Sheets.

**Метод:** лише офіційні або первинні джерела. Де документація не підтверджує продуктову гарантію, це позначено як **висновок**, а не факт.

## Короткий висновок

Для першого клієнта технічно найкращий порядок каналів: **Instagram Professional / Facebook Page Messenger → Telegram → OLX → Viber → TikTok → Threads**. TikTok має офіційний Business Messaging API, але його доступ є окремим vendor gate. Threads має приватні повідомлення у власному застосунку, однак поточний офіційний Threads API не документує доступ до DM; він придатний лише для публічних постів, згадок і відповідей. Нова пошта придатна для повного створення ЕН/ТТН через офіційний API. Google Sheets добре підходить як тимчасовий операційний інтерфейс; локальний `.xlsx` — слабка «база даних» для конкурентних записів.

Український **ФОП є реалістичною основою для Meta Business Verification**, бо це зареєстрований у державному реєстрі суб'єкт підприємництва й Meta приймає business-registration та tax-registration документи. Водночас Meta не публікує окремої гарантії для української організаційної форми «ФОП»: остаточне рішення приймає її перевірка за конкретними даними й документами. Верифікувати треба бізнес, що володіє Meta App Sales AITO; підтверджене підприємство клієнта та володіння його Page не замінюють App Review/Advanced Access застосунку.

**Рекомендована конструкція:** n8n як оркестратор інтеграцій і MVP, але канонічні замовлення, ідемпотентність, аудит, зіставлення номенклатури та правила статусів — у власному сервісі з PostgreSQL. Це гібрид, а не вибір «n8n або backend».

## Порівняльна таблиця

| Канал | Вхідні повідомлення | Відповідь API | Медіа | Головна умова/обмеження | Придатність |
|---|---:|---:|---:|---|---|
| Instagram | Webhooks + Conversations API | Так | Так, але для share повертається лише URL | Лише Professional (Business/Creator); Advanced Access для чужих акаунтів; стандартне вікно 24 год | Висока |
| Facebook Page Messenger | Webhooks | Так, після окремого outbound slice | Так | App Review/Advanced Access для сторінок клієнтів; клієнт окремо надає Page access | Висока після Meta approval |
| Telegram | Webhook або long polling | Так | Так | Бот бачить взаємодії з ботом, а не приватні чати звичайного акаунта; updates зберігаються до 24 год | Дуже висока |
| Viber | Webhook | Так | Текст, picture, video, contact, URL, location | Нові боти з 05.02.2024 лише комерційні; користувач має взаємодіяти/підписатися | Середня |
| TikTok | Business Messaging API + webhooks | Так | Завантаження/вивантаження image/video передбачене API | Потрібен Business-доступ, авторизація та security/privacy review; доступність/регіон треба підтвердити до оцінки | Середня, з ризиком доступу |
| Threads | API для публічних replies/mentions; API приватних DM не документовано | Лише публічна відповідь у thread | Пости підтримують text/image/video/carousel | Наявність DM у застосунку Threads не означає наявність DM API | Низька для приватних замовлень; середня для публічних лідів |
| OLX.ua | Threads/messages REST API; polling (webhook чатів у схемі не підтверджено) | Так | Залежить від Message schema/доступу | OAuth/Partner API, реєстрація застосунку; треба перевірити квоти й production approval | Висока після доступу |

## 0. Meta Business Verification: чи підходить український ФОП

### Що підтверджено офіційними джерелами

- Meta описує Business Verification як підтвердження зареєстрованого бізнесу (її точне англійське формулювання — `registered legal business entity`) і загалом приймає certificate of business registration/incorporation, business license, tax registration certificate та, як допоміжне підтвердження адреси, рахунок за комунальні послуги або банківську виписку на ім'я бізнесу. Для країни без окремого списку Meta просить найрелевантніший офіційний реєстраційний документ, виданий державою: [Meta — Business verification](https://developers.meta.com/vr/resources/publish-organization-verification-business/). Український ФОП є зареєстрованою фізичною особою-підприємцем, а не юридичною особою; Meta окремо не пояснює цю правову форму. Ця сторінка описує спільну логіку Meta organization verification, а конкретний перелік, який покаже Social Technologies Business Manager, залишається визначальним.
- Під час перевірки Meta зіставляє назву, адресу, телефон, сайт і за наявності tax ID з публічними записами; контакт підтверджується кодом через доступний email/телефон/SMS. Типові причини відмови — розбіжність назви, нечіткий/прострочений документ або відсутність назви, реєстраційного номера чи адреси: [Meta — Business verification](https://developers.meta.com/vr/resources/publish-organization-verification-business/).
- Дія прямо визначає витяг з ЄДР як документ з відомостями про юридичних осіб **або фізичних осіб-підприємців** і дозволяє ФОП сформувати його з актуальних даних ЄДР: [Дія — Витяг з ЄДР](https://diia.gov.ua/services/vityag-z-yedr). ДПС також дозволяє ФОП отримати електронний витяг з реєстру платників єдиного податку: [ДПС — витяг платника єдиного податку](https://if.tax.gov.ua/media-ark/news-ark/print-1017469.html).

### Висновок для Sales AITO

**Так, активний український ФОП варто подавати на Meta Business Verification.** Це не стовідсоткова гарантія схвалення, бо Meta не має публічного правила «усі українські ФОП приймаються», але ФОП має саме ті державні реєстраційні й податкові докази, які Meta загалом вимагає.

Рекомендований пакет:

1. Актуальний витяг з ЄДР (основний доказ реєстрації).
2. Витяг платника єдиного податку або інший актуальний податковий документ, якщо Meta запросить tax registration.
3. Документ, який Meta у конкретному flow дозволить для підтвердження адреси/телефону: банківська виписка або рахунок на те саме бізнес-ім'я; не завантажувати зайві персональні транзакції.
4. Бізнес-ім'я, адреса, телефон, tax ID і сайт у Business Portfolio — буквально так, як в офіційних документах. Для ФОП без окремої торгової юридичної назви безпечніше не підміняти ПІБ брендом у полі legal name.
5. Доступ до вказаного бізнес email/телефону; бажано email на домені Sales AITO та сторінка сайту з тією самою юридичною назвою.

### Це не те саме, що володіння клієнтською Facebook Page

- Business Verification/App Review стосуються бізнесу-розробника і Meta App Sales AITO. Вони відкривають можливість запитувати Advanced Access для даних акаунтів, які не належать розробнику.
- Кожний клієнт окремо авторизує свою Page і повинен мати Page/task access, що дозволяє працювати з повідомленнями. Meta описує Page access як окремі права на контент, повідомлення та коментарі: [Meta — About Facebook Page access](https://www.facebook.com/help/289207354498410/).
- Отже, підтверджений бізнес клієнта корисний для його власних активів, але **не замінює** верифікацію власника застосунку, App Review і Advanced Access Sales AITO. Після approval Sales AITO клієнту зазвичай не потрібен власний Meta App: він авторизує свою Page у нашому OAuth flow.

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

- TikTok for Business документує **Business Messaging API**: список розмов і повідомлень, send message, upload/download image/video, webhook configuration, automatic messages, Comment-to-Message і capability check конкретного TikTok account: [TikTok API for Business documentation](https://ads.tiktok.com/gateway/docs/index?doc_id=1772372080226305&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH).
- Доступ проходить окремий процес: реєстрація developer app, Business Messaging API access, authorization/authentication та data security/privacy review; у документації є окремі messaging limits. Сам факт, що акаунт клієнта verified, не надає нашому SaaS app цей API access: [TikTok API for Business documentation](https://ads.tiktok.com/gateway/docs/index?doc_id=1772372080226305&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH).
- Business Center дозволяє адміністраторам/операторам працювати з direct messages. Офіційна довідка вимагає Verified Business Account для інтеграції Business Account з Business Center; окрема актуальна сторінка уточнює, що для Business Center у US/EU/UK verified status обов'язковий: [TikTok — direct-message permissions](https://ads.tiktok.com/resources/help/article/how-to-grant-users-permissions-to-manage-direct-messages?lang=en), [TikTok account integration with Business Center](https://ads.tiktok.com/resources/help/article/business-account-integration-with-business-center?lang=en).
- Автовідповіді (welcome, keyword reply, suggested questions, chat prompts) доступні для Advanced Access + Verified Business Account, не General account: [TikTok automatic messages](https://ads.tiktok.com/help/article/navigate-auto-message-business-accounts?lang=en).
- Окремий Data Portability API може експортувати direct messages за згодою користувача, але це механізм перенесення архіву, а не real-time customer-support inbox: [TikTok Data Portability API](https://developers.tiktok.com/docs/en/data-portability-api-get-started).

### Висновки для системи

- TikTok уже не слід автоматично відкидати як «API чатів немає»: Business Messaging API офіційно існує.
- Для SaaS order ingestion набір endpoint-ів достатній у принципі: webhook приймає нову подію, backend дедуплікує її, завантажує дозволене media, нормалізує message/conversation IDs і запускає наявний order-recognition pipeline.
- Але до включення в MVP треба отримати API access для developer app, пройти security/privacy review, авторизувати тестовий Business Account, перевірити `capability` endpoint і фактичні messaging limits. Офіційна документація не дає публічної гарантії доступності Business Messaging API для української компанії/акаунта; це vendor gate, який треба підтвердити в кабінеті або через TikTok for Business.
- У n8n немає підтвердженого first-party Business Messaging node; використовувати webhooks + HTTP Request після approval.

## 5. Threads

### Підтверджені факти

- У липні 2025 року Meta додала приватні direct messages у сам застосунок Threads; пізніше додала message requests, media та group chats: [Meta Newsroom — Introducing Messaging on Threads](https://about.fb.com/news/2025/07/introducing-messaging-highlighted-perspectives-threads/).
- Це **не означає наявність API для DM**. Станом на дату перевірки офіційний Threads API/Meta Postman workspace документує OAuth і permissions `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies`, `threads_manage_insights`, `threads_keyword_search`, `threads_manage_mentions` тощо, але не має messaging permission або endpoint для читання/надсилання приватних повідомлень: [Meta official Threads API workspace](https://www.postman.com/meta/threads/overview), [Threads API documentation](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).
- API може публікувати text/image/video/carousel posts, читати публічні replies, будувати публічну conversation tree, приховувати/схвалювати replies, відповідати на конкретний reply, шукати публічні posts і отримувати mentions: [Threads API — replies and conversations](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-74fb48b1-ad1a-480e-b200-4dcdb8126a2f), [Threads API — discover](https://www.postman.com/meta/threads/folder/u4wm9lw/discover-threads).

### Висновки для системи

- Підключити Threads як приватний inbox на кшталт Instagram/Facebook/TikTok зараз не можна через опублікований API. Не можна обіцяти автоматичне збирання замовлень із Threads DM.
- Реалістичний обмежений сценарій — публічні ліди: читати replies/mentions до posts бізнесу, створювати lead/conversation із чіткою позначкою `public`, відповідати публічно й переводити клієнта у підтримуваний приватний канал. Це вимагає окремого privacy/moderation дизайну і не повинно маскуватися під DM.
- Не використовувати browser automation/scraping приватної скриньки Threads. Перевіряти changelog перед майбутнім spike: поява DM у споживчому застосунку не є контрактом для стороннього SaaS.

## 6. OLX Україна Partner API

### Підтверджені факти

- OLX має офіційний Developer Portal з реєстрацією застосунку й OAuth: [OLX Developer Portal](https://developer.olx.ua/en).
- Актуальна первинна OpenAPI-схема містить `GET /threads`, `GET /threads/{threadId}`, `GET /threads/{threadId}/messages` і `POST /threads/{threadId}/messages`: [OLX Partner API OpenAPI YAML](https://developer.olx.ua/swagger/v2/partner_api.yaml).
- Схема також містить оголошення, користувачів, довідники категорій/локацій тощо, тож повідомлення можна зв’язувати з `advert_id` і каталогом OLX: [OLX Partner API schema](https://developer.olx.ua/swagger/v2/partner_api.yaml).

### Висновки для системи

- Для чатів доступний офіційний шлях; браузерний scraping не потрібен і не рекомендується.
- У перевіреній схемі ми підтвердили REST endpoints, але не підтвердили webhook для нового повідомлення. Отже, початковий дизайн — інкрементальний polling із дедуплікацією за message/thread ID, доки OLX не підтвердить webhook іншою документацією.
- Потрібно до оцінки отримати production credentials і перевірити rate limits/договірні умови. В n8n first-party OLX node не підтверджено; викликати API через HTTP Request.

## 7. Нова пошта API 2.0

### Підтверджені факти

- Офіційна сторінка прямо заявляє: API може автоматично створювати й зберігати електронні накладні, рахувати вартість, трекати статуси, друкувати маркування, змінювати ЕН і замовляти переадресацію/повернення: [Нова пошта — можливості інтеграції](https://novaposhta.ua/for-business/cooperation/integration/).
- Офіційні entrypoints: `https://api.novaposhta.ua/v2.0/json/` і `/xml/`, HTTPS GET/POST. API key створюється безкоштовно в бізнес-кабінеті: [Нова пошта — інтеграція](https://novaposhta.ua/for-business/cooperation/integration/).
- Детальний developer portal: [Nova Poshta API 2.0](https://developers.novaposhta.ua/).

### Висновки для системи

- Повне створення ТТН/ЕН і повернення номера клієнту — реалістичний офіційний сценарій.
- Не створювати ЕН лише на основі AI-витягу без перевірки обов'язкових полів. Мінімально валідовувати телефон, ПІБ, населений пункт/warehouse ref або точну адресу, тип доставки, вагу/місця, оголошену вартість, платника й післяплату.
- Зберігати `order_id ↔ Ref/IntDocNumber`, сирий request/response, статус і помилки; повторний запуск не повинен створювати дубль ТТН.
- У n8n first-party Nova Poshta node не підтверджено; API легко викликається HTTP Request node, але бізнес-правила та ідемпотентність краще тримати у backend.

## 8. n8n та таблиці

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

## 9. Рейтинг придатності для першого MVP

1. **Instagram + Google Sheets + Telegram + backend/Postgres + n8n** — найкраще відповідає описаному процесу.
2. **Нова пошта** — додати після стабілізації extraction/validation, але архітектурно передбачити одразу.
3. **OLX** — хороший другий sales channel після отримання Partner API production access; почати з polling.
4. **Viber** — лише якщо клієнт готовий до комерційного chatbot onboarding.
5. **TikTok** — technical spike після підтвердження Business Messaging access у регіоні.
6. **Threads** — лише публічні replies/mentions; приватні замовлення відкласти до появи офіційного DM API.

## 10. Перевірки до оцінки розробки

- Професійний статус Instagram акаунта, ownership у Meta Business, можливість App Review/Advanced Access.
- Meta Business Verification власника Sales AITO app: точний legal name ФОП, актуальний ЄДР/податковий документ, адреса й контрольований бізнес-контакт; не плутати з Page access клієнта.
- Чи замовлення приходять у bot/business inbox, а не в особисті Telegram/Viber акаунти.
- OLX application approval, scopes, quota/rate limits і тест реального `/threads`.
- TikTok region eligibility, Verified Business Account, Business Messaging API approval і limits.
- Для Threads не оцінювати приватний inbox, доки офіційний API не додасть явні DM permissions/endpoints; public replies/mentions оцінювати як окремий канал.
- Реальний шаблон Excel/Google Sheet, унікальні SKU/aliases, якість фото та 100–300 анонімізованих переписок для evaluation.
- API key Нової пошти, дані відправника, типи доставки/оплати, правила післяплати й тестовий процес скасування дубльованої ЕН.

## Рівень певності

- **Високий:** Telegram, Viber commercial rule, Instagram Professional/permissions/webhooks/24h, Threads public API має replies/mentions/posts і не документує DM API, OLX thread endpoints, Nova Poshta API entrypoints/capabilities.
- **Середній:** ФОП має релевантні офіційні реєстраційні документи для Meta Business Verification, але Meta вирішує кожну заявку індивідуально; конкретний n8n Instagram event coverage слід перевірити на живому Meta app; generic webhook/HTTP API шлях точно доступний.
- **Потребує vendor confirmation:** TikTok Business Messaging eligibility для українського developer/business account і конкретні limits; OLX production quotas/webhook availability; комерційна ціна Viber.

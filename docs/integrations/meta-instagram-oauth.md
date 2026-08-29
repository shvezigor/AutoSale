# Підключення Meta Instagram OAuth через ngrok

Цей посібник призначений для локального Docker-розгортання AutoSale. Він
налаштовує **Instagram API with Instagram Login** для професійних акаунтів
Instagram типу Business або Creator. Особисті Instagram-акаунти не підтримані.

Під час першого запуску застосунок працює за стабільним доменом ngrok. Пізніше
його можна замінити на власний домен через Cloudflare Tunnel; код OAuth при
цьому не змінюється.

## Що потрібно підготувати

- Обліковий запис Meta for Developers, який має право створити застосунок.
- Два тестові професійні Instagram-акаунти: один Business і один Creator. Для
  production достатньо лише тих типів акаунтів, які буде підключати клієнт.
- Обліковий запис ngrok і його authtoken.
- Локальна копія репозиторію, Docker Desktop/Engine і Node.js.
- Приватне сховище секретів (password manager або secrets vault). Не надсилайте
  секрети в чат, issue, screenshot або Git.

Офіційні довідки: [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/),
[Meta App Review](https://developers.facebook.com/docs/app-review/),
[Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/),
[обмеження безкоштовного ngrok](https://ngrok.com/docs/pricing-limits/free-plan-limits).
Назви та розташування екранів Meta можуть змінюватися; нижче вказано мету й
значення кожного налаштування, а не покладається на конкретний скриншот.

## 1. Підготуйте `.env` і локальний Docker

У корені репозиторію створіть локальний `.env` з `.env.example`, якщо його ще
немає. `.env` ігнорується Git; не додавайте його до індексу.

Згенеруйте новий ключ шифрування. Команда друкує **новий** ключ, а не читає
наявні секрети:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Скопіюйте один результат у `INTEGRATION_ENCRYPTION_KEY` у локальному `.env`.
Збережіть його в захищеному резервному сховищі: без точно цього ключа раніше
збережені токени Instagram стануть непридатними для читання. Не обертайте
значення в лапки та не генеруйте новий ключ для вже підключеного середовища без
плану міграції токенів.

Перед отриманням даних Meta заповніть або перевірте такі локальні змінні. Тут
наведено лише плейсхолдери, а не значення секретів.

| Змінна в кореневому `.env` | Значення для цього запуску |
| --- | --- |
| `APP_PUBLIC_URL` | `https://<assigned-name>.ngrok-free.app` |
| `META_APP_ID` | Instagram App ID із налаштування Instagram Login у вашому Meta app |
| `META_APP_SECRET` | відповідний Instagram App Secret; зберігати лише в `.env`/vault |
| `META_VERIFY_TOKEN` | випадковий секретний рядок щонайменше з 24 символів; саме його треба ввести в Meta для перевірки webhook |
| `META_GRAPH_API_VERSION` | підтримувана зафіксована версія Graph API, наприклад значення з `.env.example`; не використовуйте `latest` |
| `INTEGRATION_ENCRYPTION_KEY` | щойно згенерований canonical Base64-рядок рівно для 32 байтів |

`META_APP_ID` має бути числовим ідентифікатором, а не назвою застосунку.
`META_APP_SECRET`, `META_VERIFY_TOKEN` та `INTEGRATION_ENCRYPTION_KEY` —
секрети. Не вставляйте їх у документацію, URL, логи або front-end.

Запустіть стек з кореня репозиторію:

```powershell
docker compose up --build -d
docker compose ps
```

Дочекайтеся, поки `api`, `web`, `worker`, `postgres`, `redis`, `minio` і
`proxy` будуть запущені, а `migrate` завершиться успішно. Caddy у `proxy`
приймає локальний HTTP на порту 80 і маршрутизує `/api/*`, `/health/*` та
`/webhooks/*` в API; решта шляхів іде у web-застосунок.

## 2. Увімкніть стабільний домен ngrok

У безкоштовному плані ngrok призначає один development domain. Він стабільний
для цього облікового запису, але його ім'я не можна обрати або довільно
змінити. Візьміть **точно** призначений hostname з ngrok Dashboard, наприклад
`<assigned-name>.ngrok-free.app`; не підставляйте довільне ім'я.

Один раз на комп'ютері, де працює Docker, додайте свій authtoken:

```powershell
ngrok config add-authtoken <NGROK_AUTHTOKEN>
```

Після того як `APP_PUBLIC_URL` у `.env` уже дорівнює
`https://<assigned-name>.ngrok-free.app`, відкрийте тунель в окремому вікні
PowerShell:

```powershell
ngrok http --url=<assigned-name>.ngrok-free.app 80
```

Не закривайте це вікно під час Meta OAuth або webhook-перевірки. Після зміни
`APP_PUBLIC_URL` перезапустіть API (найпростіше — повторити `docker compose up
--build -d`) **до** натискання «Підключити Instagram»: callback URL
обчислюється зі значення, що було при старті API.

Безкоштовний ngrok може показати разове browser-попередження перед HTML. До
OAuth відкрийте `https://<assigned-name>.ngrok-free.app` у тому самому браузері
і продовжте на сторінку AutoSale; після цього запускайте підключення. Це
попередження не замінює перевірку webhook і не є помилкою AutoSale.

Значення для Meta мають бути дослівно такими:

```text
Redirect URI: https://<assigned-name>.ngrok-free.app/api/integrations/instagram/callback
Webhook callback: https://<assigned-name>.ngrok-free.app/webhooks/meta
Verify token: точне локальне значення META_VERIFY_TOKEN
Scopes: instagram_business_basic, instagram_business_manage_messages
```

Не використовуйте `localhost`, HTTP або інший домен в одному з цих трьох
місць. Вони мають мати один origin з `APP_PUBLIC_URL`.

## 3. Створіть і налаштуйте Meta app

1. У [Meta for Developers](https://developers.facebook.com/apps/) створіть
   застосунок для бізнес-використання. Виберіть сценарій, що додає Instagram,
   і додайте продукт **Instagram API with Instagram Login**. Не змішуйте його
   з legacy-налаштуванням «Instagram API with Facebook Login»: AutoSale
   авторизує через `www.instagram.com` і використовує `graph.instagram.com`.
2. У налаштуванні Instagram Login додайте дозволений OAuth redirect URI:
   `https://<assigned-name>.ngrok-free.app/api/integrations/instagram/callback`.
   URI має збігатися посимвольно з наведеною адресою, включно з HTTPS і шляхом.
3. У секції, що показує облікові дані саме Instagram Login, скопіюйте Instagram
   App ID у `META_APP_ID`. Відкрийте/скопіюйте відповідний Instagram App Secret
   лише у захищене сховище та локальний `.env` як `META_APP_SECRET`. Не
   підмінюйте їх загальними Facebook credentials, якщо Dashboard показує
   окрему пару для Instagram Login.
4. У налаштуванні webhook для Instagram задайте callback
   `https://<assigned-name>.ngrok-free.app/webhooks/meta` і вставте **точне**
   поточне локальне значення `META_VERIFY_TOKEN` як verify token. Якщо Meta
   пропонує вибір полів підписки, увімкніть `messages`.
5. Збережіть конфігурацію і дочекайтеся успішної Meta verification. API
   відповідає на `GET /webhooks/meta` лише коли `hub.mode=subscribe`, verify
   token збігається, а `hub.challenge` не порожній. Вхідні `POST` додатково
   перевіряються заголовком `X-Hub-Signature-256` через `META_APP_SECRET`.

Під час OAuth AutoSale завжди запитує лише такі scopes:

```text
instagram_business_basic, instagram_business_manage_messages
```

Не додавайте зайвих scopes «про всяк випадок»: це збільшує обсяг App Review і
не розширює можливості цієї версії AutoSale.

## 4. Додайте та активуйте тестерів

Поки застосунок у Development mode, протестуйте обидва професійні типи
акаунтів. У розділі ролей/Instagram testers Meta app запросіть:

1. Business Instagram-акаунт за його username (не відображуваним ім'ям).
2. Creator Instagram-акаунт за його username.

Власник кожного запрошеного акаунта мусить увійти саме в цей Instagram-акаунт
і прийняти tester invite у розділі Apps and websites / Tester invites. Статус
`Pending` не дає права пройти OAuth. Поверніться до Dashboard і переконайтеся,
що запрошення активне; за потреби також перевірте, що особа має потрібну роль
у Meta app.

**Development mode** — для розробки: авторизацію проходять лише додані й
активні тестери/ролі. **Live mode** не обходить перевірку доступів: перед ним
отримайте у Meta той рівень доступу, який вимагається для реальних акаунтів
користувачів. У поточному Dashboard це зазвичай відображається як Standard
Access (розробка/дозволене тестове використання) та Advanced Access (ширше
використання після схвалення); актуальні вимоги видно поруч з кожним
permission. Не перемикайте застосунок у Live лише заради обходу tester list.

## 5. App Review і перехід у Live

До подання переконайтеся, що працює весь checklist нижче. Для кожного з двох
потрібних permissions подайте рівно заявлене використання:

- `instagram_business_basic` — ідентифікувати професійний Instagram-акаунт і
  показати його username у налаштуваннях tenant;
- `instagram_business_manage_messages` — приймати вхідні повідомлення,
  безпечно маршрутизувати їх до відповідного tenant і показувати у робочому
  процесі AutoSale.

У матеріалах App Review дайте Meta відтворюваний сценарій: тестовий Business
або Creator акаунт, вхід у AutoSale як `OWNER`, шлях до **Налаштування →
Instagram → Підключити Instagram**, дозвіл OAuth і демонстрацію одного
вхідного повідомлення. Надавайте тестові облікові дані лише через захищений
канал, який запитує Meta; ніколи не включайте реальні токени в опис або відео.
Додайте політику конфіденційності, інструкції для reviewer і пояснення, чому
кожен scope потрібен. Після схвалення потрібного рівня доступу та власної
перевірки перемкніть app у Live mode згідно з поточними вимогами Meta.

## 6. Приймальний тест від початку до кінця

Виконуйте перевірку при запущених Docker і ngrok, увійшовши в AutoSale як
`OWNER` потрібного tenant.

- [ ] Відкрити **Налаштування**, натиснути **Підключити Instagram** і
  переконатися, що браузер переходить на Instagram OAuth та повертається до
  `https://<assigned-name>.ngrok-free.app/api/integrations/instagram/callback`.
- [ ] Після успіху повернутися на `/settings?instagram=connected`; картка
  Instagram показує стан **Активне** і username підключеного акаунта.
- [ ] У Meta успішно збережено й перевірено webhook callback; повторна
  перевірка повертає challenge.
- [ ] Надіслати одне справжнє вхідне повідомлення на підключений професійний
  Instagram-акаунт і перевірити, що webhook прийнято та повідомлення з'явилося
  лише у правильному tenant. Не використовувати для цього payload із токеном.
- [ ] Переконатися, що інший tenant не отримав цю подію і не може привласнити
  той самий зовнішній Instagram account ID.
- [ ] Натиснути **Перепідключити Instagram** (якщо картка цього потребує) та
  завершити OAuth; username і активний стан мають оновитися.
- [ ] Натиснути **Відключити Instagram**, підтвердити дію, а потім
  перепідключити; нове підключення має знову стати активним. Якщо віддалене
  очищення не завершилося, картка показує **Повторити очищення** замість
  підключення: завершіть очищення цією кнопкою й лише потім підключайте акаунт.
- [ ] Переглянути відповідь `GET /api/integrations/instagram` у browser network
  panel: у ній допустимі лише статус, account ID, username, дати та безпечний
  код помилки — access token у відповіді відсутній.
- [ ] Переглянути логи контейнерів у рамках тесту й переконатися, що там немає
  access token, `META_APP_SECRET`, `META_VERIFY_TOKEN` або
  `INTEGRATION_ENCRYPTION_KEY`.

Не заявляйте про готовність до Live, якщо не пройдено реальний callback,
підписку webhook і одне реальне вхідне повідомлення.

## 7. Несправності

| Симптом | Що перевірити |
| --- | --- |
| Meta не може перевірити webhook | `docker compose ps`, активне вікно ngrok, точний HTTPS callback, точний `META_VERIFY_TOKEN`, порт 80 на локальному хості. Після зміни `.env` перезапустіть API. |
| OAuth повертає помилку redirect URI | `APP_PUBLIC_URL` і дозволений URI в Meta мають бути одним origin; шлях має бути саме `/api/integrations/instagram/callback`. Не допускаються `localhost`, HTTP, інший ngrok hostname або зайвий slash. |
| Browser зупиняється на попередженні ngrok | Відкрийте public ngrok URL у тому самому браузері, продовжте до AutoSale, а потім повторіть OAuth. Це особливість browser-трафіку безкоштовного ngrok, а не Meta webhook. |
| Тестер не бачить або не може завершити OAuth | Instagram-акаунт має бути Business/Creator, введено його username, а запрошення прийнято саме цим Instagram-акаунтом. Перевірте Development mode і активний статус tester. |
| Підключення завершується `META_REQUIRED_SCOPES_MISSING` | У Meta app дозвольте рівно `instagram_business_basic` і `instagram_business_manage_messages`; повторіть OAuth після зміни доступів. |
| Підключення завершується `META_SUBSCRIPTION_FAILED` або повідомлення не надходять | Перевірте callback verification, поле `messages`, активність тунелю й App Review/access для цього акаунта. Успішний OAuth сам створює підписку `messages`; не підміняйте її ручним токеном. |
| Картка показує «Потрібне перепідключення» | Токен прострочений, OAuth був відхилений або змінилися доступи. Увійдіть як `OWNER` і натисніть **Перепідключити Instagram**. |
| Картка показує `META_DISCONNECT_CLEANUP_FAILED` | Локальне підключення вже вимкнене, але Meta не підтвердила unsubscribe/revoke. Увійдіть як `OWNER`, відновіть доступ до Meta й натисніть **Повторити очищення**. Нове OAuth-підключення заблоковане, доки збережений credential не буде очищено. |
| Локальний URL відкривається, а Meta не надсилає події | Комп'ютер, Docker і ngrok мають одночасно працювати; sleep, перезавантаження, закрите вікно ngrok або ліміт безкоштовного плану роблять callback недосяжним. |

## 8. Міграція на власний домен через Cloudflare Tunnel

Коли придбано домен і його зона додана до Cloudflare, можна опублікувати
поточний локальний Caddy без публічної IP-адреси. Cloudflare Tunnel працює так:
`cloudflared` на хості встановлює вихідне з'єднання до Cloudflare, а Cloudflare
надсилає HTTPS-трафік до локального HTTP origin. Докладні офіційні кроки:
[створення керованого tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
та [Cloudflare Tunnel без публічної IP-адреси](https://developers.cloudflare.com/cloudflare-one/networks/connectivity-options/).

1. У Cloudflare створіть named/remote tunnel, встановіть запропонований
   `cloudflared` connector на тому самому хості, де працює Docker, і дочекайтеся
   стану Healthy.
2. Додайте Published application route для, наприклад,
   `https://autosale.example.com` до локального сервісу `http://localhost:80`.
   Поточний `compose.yaml` уже публікує Caddy на порт 80; tunnel не є
   сервісом у цьому Compose-файлі. Забороніть зовнішній вхідний TCP 80/443
   firewall-ом або обмежте binding портів до loopback, якщо ви змінюєте Compose;
   `cloudflared` не потребує вхідного відкритого порту чи публічної IP-адреси.
3. У кореневому `.env` замініть лише public origin:
   `APP_PUBLIC_URL=https://autosale.example.com`. Не змінюйте секрети через
   сам факт міграції домену.
4. У Meta замініть **обидві** адреси: дозволений redirect URI на
   `https://autosale.example.com/api/integrations/instagram/callback` і
   webhook callback на `https://autosale.example.com/webhooks/meta`. Verify
   token лишається точним локальним `META_VERIFY_TOKEN`.
5. Перезапустіть стек (`docker compose up --build -d`), дочекайтеся Healthy
   tunnel, повторіть Meta webhook verification і весь приймальний тест із
   розділу 6. Наявні підключення краще перепідключити, щоб Meta OAuth token
   був випущений із новим callback URI.

Після міграції `cloudflared`, Docker і хост так само мають бути постійно
доступні. Cloudflare знімає потребу в публічній IP-адресі та inbound port
forwarding, але не робить вимкнений локальний origin доступним.

## 9. Перевірка документації перед commit

Перш ніж комітити, перевірте, що документація містить тільки інструкції та
плейсхолдери, а не реальні значення секретів:

```powershell
rg -n "META_APP_SECRET=|INTEGRATION_ENCRYPTION_KEY=" docs .env.example
git diff --check
```

Очікувано `rg` знаходить у `.env.example` лише безпечні плейсхолдери, а
`git diff --check` не виводить помилок.

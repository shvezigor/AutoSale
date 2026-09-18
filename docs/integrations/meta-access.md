# Meta integration access

## Налаштування OAuth і локального тунелю

Повний український посібник із локального запуску Docker, стабільного
ngrok-домену, Meta Instagram Login, тестерів, App Review, webhook і міграції
на Cloudflare Tunnel: [meta-instagram-oauth.md](meta-instagram-oauth.md).

Актуальний стан заявки, блокери та сценарій обов'язкових screencast:
[meta-app-review.md](meta-app-review.md).

Поточна інтеграція приймає лише Instagram Professional Business і Creator
акаунти через Instagram API with Instagram Login. Її єдина public webhook
адреса — `/webhooks/meta`, а OAuth callback —
`/api/integrations/instagram/callback` від `APP_PUBLIC_URL`.

## Відповіді з діалогу AutoSale

- Власник або менеджер може відповідати лише в уже створеному клієнтом
  Instagram-діалозі. AutoSale не використовує цей API для холодних розсилок і
  не обходить установлене Meta вікно обміну повідомленнями.
- Для надсилання потрібен чинний `instagram_business_manage_messages`. Токен
  розшифровується тільки у worker і ніколи не передається браузеру.
- `Надсилається…` означає, що повідомлення збережене й очікує worker;
  `Надіслано` — Meta повернула ID повідомлення або webhook echo підтвердив його.
- `Статус доставки невідомий` з’являється після timeout або неоднозначної
  помилки Meta. Автоматичний retry заборонений, щоб не створити дубль; AutoSale
  ще очікує echo.
- `Повторити надсилання` доступне лише після підтвердженого rate limit. Помилка
  доступу переводить Instagram-підключення у стан, що потребує повторної
  авторизації власником.

Fixture browser acceptance запускається лише в ізольованому середовищі, де
Meta Send API спрямований у контрольований stub. Потрібні
`E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `META_APP_SECRET`,
`E2E_INSTAGRAM_ACCOUNT_ID` і `E2E_META_SEND_STUB=1`. Для retry-сценарію також
потрібні заздалегідь створені безпечні fixture-значення
`E2E_INSTAGRAM_RETRY_CONVERSATION_ID` та `E2E_INSTAGRAM_RETRY_TEXT`.

Реальна фінальна перевірка після надання Meta permission: відправити з AutoSale
одну нейтральну відповідь, побачити її рівно один раз в Instagram та AutoSale,
перезавантажити сторінку, а потім окремо перевірити погоджену trigger-фразу.
Зберігати як evidence можна лише санітизовані ID, статуси й час — без токенів та
тексту клієнта.

## Інцидент 2026-09-18: хибний `REAUTH_REQUIRED` після відправлення

### Симптом

- OAuth завершується успішно, webhook `/webhooks/meta` приймає події, але перша
  невдала відповідь клієнту переводить всю інтеграцію у
  `INSTAGRAM_RECONNECT_REQUIRED`.
- Повторне підключення тимчасово показує `ACTIVE`, однак наступна невдала
  відправка знову повертає той самий стан.

### Першопричина

Було дві пов'язані помилки в адаптері відправлення:

1. Запит надсилався на alias `/me/messages`, хоча Send API для Instagram Login
   документує endpoint `/{instagram-account-id}/messages`. Збережений
   `externalAccountId` не передавався з worker до Meta-клієнта.
2. Будь-які provider codes `10`, `190` або `200` вважалися доказом
   недійсного токена. Codes `10` і `200` можуть описувати заборону для
   конкретного одержувача або конкретної операції; вони не доводять, що OAuth
   token чи webhook subscription втрачено. Через це локальний стан
   `REAUTH_REQUIRED` міг бути хибним і зберігався навіть при справному токені.

Попереднє виправлення від'єднання Instagram було присутнє в релізі. Цей
інцидент повторився не через втрачений commit, а через окрему помилку Send API,
яку попередній fix не охоплював.

### Виправлення

- `MetaInstagramClient.sendText` тепер вимагає явний Instagram account ID і
  викликає `/{instagram-account-id}/messages`.
- Worker читає `externalAccountId` тієї самої активної credential generation і
  передає його до клієнта разом з recipient ID.
- Лише provider code `190` переводить підключення у `REAUTH_REQUIRED`.
  Codes `10` і `200` завершують конкретне повідомлення контрольованою помилкою,
  але залишають справне підключення активним.

### Безпечна діагностика

Перевіряти шари окремо й не просити користувача циклічно перепідключати акаунт:

1. `POST /webhooks/meta` має повертати 2xx для підписаних подій.
2. У `instagram_connections` перевірити лише `status`, `last_error_code`,
   `token_expires_at`, `last_verified_at`, `granted_scopes` і наявність
   encrypted token. Не виводити token або повний account ID.
3. Усередині worker виконати read-only identity probe `GET /me` з bearer token;
   у evidence зберегти тільки HTTP status і provider code.
4. Виконати read-only subscription probe `GET /me/subscribed_apps`; очікується
   200 і поле `messages`. Не записувати response body, токен чи персональні дані.
5. Звірити `messages.delivery_error_code`. `INSTAGRAM_RECONNECT_REQUIRED`
   допустимий лише після Meta code `190`, помилки decrypt або фактичного
   завершення `token_expires_at`.
6. Code `10`/`200` діагностувати на рівні конкретного recipient, messaging
   window, app role/review та дозволеної операції. Він не є підставою
   деактивувати підключення.

Після позитивних identity і subscription probes хибний локальний
`REAUTH_REQUIRED` можна повернути в `ACTIVE`, очистивши `last_error_code` для
тієї самої credential generation. Перед зміною обов'язково звірити generation,
щоб не перезаписати новіше підключення.

Контрольна регресія: adapter test має доводити точний account-scoped URL, а
worker test — що code `190` вимагає reconnect, тоді як `10`/`200` не змінюють
стан активного підключення.

Офіційний контракт Send API: [Meta Instagram API workspace](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

## Локальна перевірка — 2026-08-26

- Контейнер міграції Docker успішно застосував `20260826090000_init_webhook_events`.
- Перевірки стану API та proxy пройшли успішно.
- `GET /webhooks/meta` повернув переданий challenge для налаштованого локального verify token.
- Автоматичні тести перевіряють коректні й некоректні callbacks з
  `X-Hub-Signature-256`, стійку реєстрацію та придушення повторів.

## Перевірка staging / реального Meta — частково виконана

Реальний HTTPS callback і webhook налаштовані, verification та тест поля
`messages` успішні. Для завершення end-to-end перевірки й App Review ще
потрібні окремий Instagram Professional test account та screencast. OAuth
потік не вимагає ручного page access token. Секрети й вміст повідомлень не
належать до цього документа.

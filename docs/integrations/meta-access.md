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

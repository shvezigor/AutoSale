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

# Acceptance checklist Instagram → Google Sheets

## Автоматизовано локально

- [x] Реєстрація, login/reset, session cookie, CSRF і role guards покриті тестами.
- [x] Власник керує запрошеннями й Instagram-підключенням; менеджер не бачить Team, але має read-only доступ до Settings зі статусом Instagram без кнопок зміни.
- [x] Платформний адміністратор отримує лише privacy-safe агрегати.
- [x] Bootstrap адміністратора й власника читає пароль тільки зі stdin.
- [x] Підписаний Meta fixture приймається webhook endpoint.
- [x] Текст і фото з’являються в одному Instagram-діалозі.
- [x] Повторна доставка того самого Meta event створює рівно одне повідомлення.
- [x] Повторна доставка inbound text повторно входить в idempotent order-intent boundary, щоб retryable failure відновився без дубльованого замовлення; attachment-only подія не запускає order recognition.
- [x] Worker recovery читає `job_name` з bounded discovery function і повертає незавершені Instagram/Facebook/TikTok events у правильну provider queue.
- [x] Менеджер відкриває AI-сформоване замовлення та бачить товар і Sheets status.
- [x] Backup відновлює conversation, order, attachment і MinIO object у чистий Compose namespace.
- [x] API, worker і web проходять health checks після restore.
- [x] 2026-08-28: `pnpm test` завершився успішно (232 tests у 67 test files; database package не має test files).
- [x] 2026-08-28: `pnpm typecheck`, `pnpm build` і `git diff --check` завершилися успішно.
- [x] 2026-08-28: ізольований Compose namespace `autosale-oauth-verify` зібраний; `migrate` завершився успішно, а API, worker, web, PostgreSQL, Redis і MinIO стали healthy (proxy running).
- [x] 2026-08-28: локальні HTTP межі в ізольованому namespace: `GET /health/live` → 200, неавторизований `GET /api/integrations/instagram` → 401. Для ізоляції від уже зайнятого host port 80 перевірка використала `http://localhost:18080`.
- [x] 2026-08-28: переглянуто санітизовані API logs; секрети й access tokens не виводяться.
- [x] 2026-09-03: tenant Google OAuth, одноразовий state, encrypted refresh token, reconnect і fenced cleanup покриті тестами.
- [x] 2026-09-03: Google Picker, server-side file/tab validation, catalogue import і exactly-once order export використовують tenant OAuth.
- [x] 2026-09-03: owner/manager Google settings privacy boundary, 476 tests, typecheck і production build пройшли локально.
- [x] 2026-09-07: ручні Instagram-відповіді покриті контрактами, tenant authorization, idempotency, durable delivery, безпечними status/retry та echo reconciliation тестами.
- [x] 2026-09-07: web-композер перевірено для Enter/Shift+Enter, optimistic pending, late echo після UNKNOWN, retry без нового bubble та недоступного підключення.
- [x] 2026-09-11: доставка Новою Поштою покрита tenant-scope матрицею для connection, location, draft, quote, create, label, cancel і customer message; `apiKey`, credentials, телефон, адреса та raw provider payload централізовано маскуються в structured logs і заборонені як metric labels.
- [x] 2026-09-11: mobile regression на 390×844 підтверджує відсутність горизонтального overflow, стабільну ширину кнопки під час loading, sticky actions, праве розташування toast і повернення focus після закриття drawer.
- [x] 2026-09-11: production migration `20260910180000_delivery_foundation` застосована; API, web, worker, PostgreSQL, Redis і MinIO healthy, `https://sales-aito.com/login` повертає 200, а delivery feature flag увімкнений після health-check.
- [x] 2026-10-02: Facebook Page OAuth/Page selection, encrypted credential lifecycle, signed `object: page` webhook routing, tenant-safe normalization/ingestion та read-only inbox покриті автоматизованими contract, integration, API, worker і web тестами.
- [x] 2026-10-02: Facebook text/image/video/link/unsupported fixtures не створюють порожніх повідомлень; повторна доставка має одну provider identity й одне повідомлення, а повторний вхід у idempotent order-intent boundary не створює другого замовлення.
- [x] 2026-10-02: Facebook connection/settings та inbox мають owner/manager межу, локалізовані помилки, collapsed-by-default UI і явний `CHANNEL_READ_ONLY` без Instagram composer.
- [x] 2026-10-04: TikTok inbound Slice A покритий tenant-safe OAuth, encrypted credential lifecycle, app-level signed webhook, durable deduplication, text/image/video/shared-post normalization, authenticated media copy, token refresh, idempotent retryable order triggering та inbox/settings тестами.
- [x] 2026-10-04: opt-in TikTok inbound browser acceptance використовує лише fictional payload і перевіряє повторну signed delivery, рівно одне повідомлення, TikTok label та правдиву reply capability; без підключеного ізольованого test account сценарій безпечно пропускається.
- [x] 2026-10-04: manual TikTok replies покриті capability/window contracts, локальною idempotency, generation-fenced API/worker delivery, безпечним reconciliation, shared Instagram/TikTok composer і opt-in outbound browser scenario.
- [x] 2026-10-04: Facebook/TikTok runtime gates мають audited platform-admin API та UI, fail-closed database state, deployment-flag hard ceiling і worker re-check перед provider side effect. Повний набір із 1 943 тестів, typecheck і production build пройшли; opt-in admin browser mutation без ізольованих `E2E_ADMIN_*` доступів безпечно пропущено.
- [x] 2026-10-04: коміт `a896fff` розгорнуто вручну після application-consistent backup `20261004T113237Z`; п’ять pending social-channel міграцій застосовано, API/web/worker і залежності healthy, `/`, `/login` та `/health/live` повертають 200. Owner-facing production UI коректно розрізняє active Instagram, platform-paused Facebook і deployment-unavailable TikTok, лишається collapsed by default на 390×844 та не має console warnings/errors.

## Потребує зовнішніх тестових доступів

- [x] 2026-09-18: реальне текстове повідомлення отримане з активного Instagram Professional account; окремий реальний image attachment скопійований у контрольоване сховище. Evidence перевірено лише за агрегованими статусами без тексту, профілю клієнта або provider ID.
- [x] 2026-09-18: реальна відповідь з AutoSale отримала `SENT` і provider confirmation, користувач підтвердив її появу в Instagram, а перевірка у сховищі не виявила дубльованих outbound message identities. Evidence містить лише статуси й агрегований duplicate count.
- [ ] 2026-10-02: контрольований діалог віком 96,5 години сформував коректний `HUMAN_AGENT` запит, але live Meta app відхилив його HTTP 403 / code 10. Token identity і recipient profile probes успішні, підключення лишилося `ACTIVE`, а UI отримав `INSTAGRAM_HUMAN_AGENT_UNAVAILABLE`. AutoSale позначено як Tech Provider, а `Human Agent` додано до чернетки App Review. Business verification перебуває на розгляді з 2026-08-30; після її схвалення ще потрібні Access verification, завершення чернетки й один повторний live-тест. Evidence не містить тексту, recipient ID або token.
- [x] 2026-09-18: активний Meta callback доставив свіжу подію, яка пройшла обов'язкову `X-Hub-Signature-256` перевірку перед реєстрацією, отримала унікальну external event identity та статус `PROCESSED`; дубльованих event identities не виявлено. Signature, payload і provider ID не записувалися в evidence.
- [x] 2026-09-18: на новому реальному вхідному повідомленні режим `AI_SUGGESTION` завершив оцінювання з першої спроби, створив пов'язану пропозицію замовлення з AI-response evidence, після чого менеджер підтвердив замовлення. Текст діалогу, персональні дані та provider ID не зберігалися в evidence.
- [x] 2026-09-18: approval-режими перевірено на нових реальних Instagram-запитах. `ALWAYS` створив повне замовлення як `NEEDS_REVIEW`; `ON_LOW_CONFIDENCE` системно підтвердив повне замовлення з confidence 93% при порозі 90%; `NEVER` системно підтвердив повне замовлення з confidence 96%. Окремий запит із невалідним model-returned catalogue ID безпечно залишився на перевірці, після чого regression fix `99e86a0` однозначно зіставив повторний товар з активним SKU. Робочу конфігурацію `AI_SUGGESTION + NEVER` відновлено після тестів.
- [ ] Додати та оновити рівно один рядок у тестовому Google Sheet.
- [ ] Тимчасово відкликати Google access, перевірити failed state, повернути access і виконати retry.
- [ ] У Google Cloud production project підтвердити consent screen, verified domain, точні origin/callback і restricted Picker key.
- [ ] Запустити `E2E_GOOGLE_LIVE=1` лише зі staging owner та приватною тестовою таблицею; зберегти санітизований результат без email, file ID або токенів.
- [ ] Перезапустити worker між enqueue та export і підтвердити, що повторна спроба не створює другого `order_id`.
- [ ] Видалити/перейменувати тестову вкладку, перевірити actionable error та збереження останнього валідного каталогу.
- [ ] Зафіксувати погодження власника щодо mapping полів і manager workflow.
- [ ] 2026-08-28: реальний Meta/ngrok OAuth callback, Meta webhook verification/subscription і одне реальне вхідне повідомлення залишаються pending — тестові Meta credentials, ngrok domain і Professional test account не надані. Live readiness не заявляється.
- [ ] Підключити контрольований API-ключ Нової Пошти в `Налаштування → Доставка`, вибрати відправника, контакт і точку відправлення без фіксації ключа в evidence.
- [ ] На одному погодженому тестовому замовленні перевірити quote → рівно одну ТТН → label → status sync → дозволене cancel → ручне Instagram-повідомлення; зберегти лише замаскований номер ТТН.

## Facebook Messenger live validation

- [ ] У Meta налаштовані точні production OAuth callback і webhook callback; потрібні Page permissions мають Advanced Access/App Review.
- [ ] Власник підключив одну контрольовану Facebook Page, а менеджер бачить лише безпечний read-only статус.
- [ ] Одне реальне текстове та одне реальне image-повідомлення з'явилися рівно один раз із Facebook label; evidence містить лише статуси, counts і timestamps.
- [ ] Повторна доставка одного signed event не створила другого повідомлення або другого order trigger.
- [ ] Одне явне замовлення пройшло Facebook order-intent flow рівно один раз без дубльованого замовлення.
- [ ] Reconnect і disconnect/cleanup перевірені без токенів, тексту клієнта, Page ID або PSID у evidence.
- [ ] Після live acceptance окремим рішенням змінити публічний статус; до цього `FACEBOOK_MESSENGER_ENABLED=false` лишається production default.

## TikTok Business Messaging live validation

- [ ] Sales AITO developer app отримав Business Messaging access і пройшов потрібний TikTok review.
- [ ] Production OAuth callback та `DIRECT_MESSAGE` webhook зареєстровані точно; регіон і контрольований Business Account підтверджені TikTok як eligible.
- [ ] Власник підключив один контрольований Business Account, а менеджер бачить лише безпечний read-only статус.
- [ ] Одне реальне текстове, image та video повідомлення з'явилися рівно один раз із TikTok label; evidence містить лише статуси, counts і timestamps.
- [ ] Повторна доставка signed event не створила другого повідомлення, attachment set, order trigger або замовлення.
- [ ] Reconnect і disconnect/cleanup перевірені без токенів, тексту клієнта або provider account/message IDs у evidence.
- [ ] Одна ручна відповідь у свіжому контрольованому діалозі отримала provider-confirmed `SENT` рівно один раз; повторний browser submit не створив дубль.
- [ ] До завершення live acceptance `TIKTOK_BUSINESS_MESSAGING_ENABLED=false` лишається production default; outbound replies проходять окремий gate.

## Команда

```sh
pnpm test
pnpm test:e2e
docker compose build
```

E2E запускається проти `E2E_BASE_URL` (типово `http://localhost`) і підписує fixtures значенням `META_APP_SECRET`. Не використовуйте production Instagram account або production Google Sheet для acceptance.
Для захищених сценаріїв також задайте тестові `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_ADMIN_EMAIL` та `E2E_ADMIN_PASSWORD`; деталі наведені в `docs/operations/authentication.md`.
Live Google сценарій додатково вимагає `E2E_GOOGLE_LIVE=1` і `E2E_GOOGLE_SPREADSHEET_NAME`. Не вмикайте його для production акаунта чи таблиці.
Facebook browser acceptance додатково вимагає `E2E_FACEBOOK_CONNECTED=1` і `E2E_FACEBOOK_PAGE_ID` для вже підключеної контрольованої Page. Не запускайте його проти production customer Page.
TikTok inbound browser acceptance додатково вимагає `E2E_TIKTOK_CONNECTED=1`, `E2E_TIKTOK_ACCOUNT_ID`, test-app `TIKTOK_CLIENT_ID`/`TIKTOK_CLIENT_SECRET` і вже підключений ізольований Business Account. Outbound acceptance додатково вимагає `E2E_TIKTOK_OUTBOUND_CONNECTED=1` та `E2E_TIKTOK_OUTBOUND_CONVERSATION_ID` для свіжого погодженого тестового діалогу. Не запускайте їх проти production customer account.

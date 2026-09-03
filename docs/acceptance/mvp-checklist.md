# Acceptance checklist Instagram → Google Sheets

## Автоматизовано локально

- [x] Реєстрація, login/reset, session cookie, CSRF і role guards покриті тестами.
- [x] Власник керує запрошеннями й Instagram-підключенням; менеджер не бачить Team, але має read-only доступ до Settings зі статусом Instagram без кнопок зміни.
- [x] Платформний адміністратор отримує лише privacy-safe агрегати.
- [x] Bootstrap адміністратора й власника читає пароль тільки зі stdin.
- [x] Підписаний Meta fixture приймається webhook endpoint.
- [x] Текст і фото з’являються в одному Instagram-діалозі.
- [x] Повторна доставка того самого Meta event створює рівно одне повідомлення.
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

## Потребує зовнішніх тестових доступів

- [ ] Надіслати реальне текстове повідомлення та фото в Instagram Professional account.
- [ ] Підтвердити один callback у Meta dashboard і перевірити signature/event ID evidence без PII.
- [ ] Запустити OpenAI extraction на погодженому тестовому діалозі й перевірити поля менеджером.
- [ ] Перевірити режими approval `ALWAYS`, `NEVER`, `ON_LOW_CONFIDENCE` на реальних запитах.
- [ ] Додати та оновити рівно один рядок у тестовому Google Sheet.
- [ ] Тимчасово відкликати Google access, перевірити failed state, повернути access і виконати retry.
- [ ] У Google Cloud production project підтвердити consent screen, verified domain, точні origin/callback і restricted Picker key.
- [ ] Запустити `E2E_GOOGLE_LIVE=1` лише зі staging owner та приватною тестовою таблицею; зберегти санітизований результат без email, file ID або токенів.
- [ ] Перезапустити worker між enqueue та export і підтвердити, що повторна спроба не створює другого `order_id`.
- [ ] Видалити/перейменувати тестову вкладку, перевірити actionable error та збереження останнього валідного каталогу.
- [ ] Зафіксувати погодження власника щодо mapping полів і manager workflow.
- [ ] 2026-08-28: реальний Meta/ngrok OAuth callback, Meta webhook verification/subscription і одне реальне вхідне повідомлення залишаються pending — тестові Meta credentials, ngrok domain і Professional test account не надані. Live readiness не заявляється.

## Команда

```sh
pnpm test
pnpm test:e2e
docker compose build
```

E2E запускається проти `E2E_BASE_URL` (типово `http://localhost`) і підписує fixtures значенням `META_APP_SECRET`. Не використовуйте production Instagram account або production Google Sheet для acceptance.
Для захищених сценаріїв також задайте тестові `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_ADMIN_EMAIL` та `E2E_ADMIN_PASSWORD`; деталі наведені в `docs/operations/authentication.md`.
Live Google сценарій додатково вимагає `E2E_GOOGLE_LIVE=1` і `E2E_GOOGLE_SPREADSHEET_NAME`. Не вмикайте його для production акаунта чи таблиці.

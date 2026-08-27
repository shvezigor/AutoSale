# Acceptance checklist Instagram → Google Sheets

## Автоматизовано локально

- [x] Реєстрація, login/reset, session cookie, CSRF і role guards покриті тестами.
- [x] Власник керує запрошеннями; менеджер не бачить Team/Settings.
- [x] Платформний адміністратор отримує лише privacy-safe агрегати.
- [x] Bootstrap адміністратора й власника читає пароль тільки зі stdin.
- [x] Підписаний Meta fixture приймається webhook endpoint.
- [x] Текст і фото з’являються в одному Instagram-діалозі.
- [x] Повторна доставка того самого Meta event створює рівно одне повідомлення.
- [x] Менеджер відкриває AI-сформоване замовлення та бачить товар і Sheets status.
- [x] Backup відновлює conversation, order, attachment і MinIO object у чистий Compose namespace.
- [x] API, worker і web проходять health checks після restore.

## Потребує зовнішніх тестових доступів

- [ ] Надіслати реальне текстове повідомлення та фото в Instagram Professional account.
- [ ] Підтвердити один callback у Meta dashboard і перевірити signature/event ID evidence без PII.
- [ ] Запустити OpenAI extraction на погодженому тестовому діалозі й перевірити поля менеджером.
- [ ] Перевірити режими approval `ALWAYS`, `NEVER`, `ON_LOW_CONFIDENCE` на реальних запитах.
- [ ] Додати та оновити рівно один рядок у тестовому Google Sheet.
- [ ] Тимчасово відкликати Google access, перевірити failed state, повернути access і виконати retry.
- [ ] Зафіксувати погодження власника щодо mapping полів і manager workflow.

## Команда

```sh
pnpm test
pnpm test:e2e
docker compose build
```

E2E запускається проти `E2E_BASE_URL` (типово `http://localhost`) і підписує fixtures значенням `META_APP_SECRET`. Не використовуйте production Instagram account або production Google Sheet для acceptance.
Для захищених сценаріїв також задайте тестові `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_ADMIN_EMAIL` та `E2E_ADMIN_PASSWORD`; деталі наведені в `docs/operations/authentication.md`.

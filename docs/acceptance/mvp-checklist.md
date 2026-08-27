# Acceptance checklist Instagram → Google Sheets

## Автоматизовано локально

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

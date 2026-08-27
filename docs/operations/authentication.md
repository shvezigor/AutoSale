# Автентифікація та доступи AutoSale

AutoSale використовує власні облікові записи й opaque-сесії в `HttpOnly` cookie. Паролі хешуються Argon2id, а в базі зберігаються лише хеші session/email-токенів. Власник організації бачить налаштування й команду, менеджер — лише робочі дані, платформний адміністратор — тільки технічні агрегати.

## Перший адміністратор платформи

Після міграції передайте JSON через stdin. Не додавайте пароль до аргументів команди, `.env` або shell history.

```sh
printf '%s' '{"email":"admin@example.com","name":"Platform Admin","password":"replace-with-a-long-password"}' \
  | docker compose run --rm --no-deps -T api node dist/cli/bootstrap-auth.js admin
```

Команда ідемпотентна за нормалізованим email. Повторний запуск оновлює пароль і повертає користувачу роль `PLATFORM_ADMIN`.

## Прив’язка наявної організації

Ця команда не змінює ID чи дані організації; вона створює або оновлює власника для tenant із указаним `key`.

```sh
printf '%s' '{"email":"owner@example.com","name":"Owner","password":"replace-with-a-long-password","tenantKey":"default"}' \
  | docker compose run --rm --no-deps -T api node dist/cli/bootstrap-auth.js adopt
```

## Реєстрація та запрошення

- Новий клієнт самостійно реєструє організацію на `/register` і підтверджує email.
- Власник додає менеджерів на `/team`; запрошення діє 7 днів.
- Блокування менеджера або організації негайно відкликає активні сесії.
- У production доставка email має бути налаштована до відкриття реєстрації. Секрети SMTP не передаються у браузер і не комітяться.

## E2E-перевірка

Створіть тестового власника й адміністратора bootstrap-командами, задайте `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, після чого виконайте `pnpm test:e2e`. Без цих змінних auth-сценарії пропускаються.

Після релізу перевірте `Secure; HttpOnly; SameSite=Lax` у session cookie через HTTPS, доступ менеджера до `/team` (має бути перенаправлення) і відсутність посилань на діалоги/замовлення в `/admin`.

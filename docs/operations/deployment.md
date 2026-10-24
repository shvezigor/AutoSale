# Розгортання Sales AITO на Linux Docker host

Для первинного розгортання, міграції, масштабування або відновлення production у Hetzner спочатку використовуйте [`hetzner-production.md`](hetzner-production.md). Цей документ описує provider-neutral реліз уже підготовленого Docker host.

## Вимоги

- Linux x86_64/arm64, Docker Engine із Compose v2, Git і щонайменше 4 ГБ RAM.
- DNS домену спрямований на сервер; відкриті лише TCP 80/443 і адміністративний SSH.
- Репозиторій розгорнутий під окремим системним користувачем без root-login.
- `.env` створений із `.env.example`. Для tenant Google Sheets використовується OAuth; service-account JSON дозволений лише як тимчасовий development fallback і не потрібен у production.
- Основний Compose фіксує `NODE_ENV=production` для публічного API; значення `NODE_ENV` у кореневому `.env` не може його знизити. Ізольований lifecycle acceptance має окремий override для development. Якщо SMTP не налаштований, не обіцяйте роботу реєстрації, запрошень чи відновлення пароля; див. [`authentication.md`](authentication.md).
- `POSTGRES_API_PASSWORD`, `POSTGRES_WORKER_PASSWORD` і `POSTGRES_BACKUP_PASSWORD` — три різні URL-safe секрети щонайменше з 32 символів. Вони не збігаються з owner-паролем у `DATABASE_URL`.

Для поточного Windows-host секрети можна створити без їх виведення в консоль:

```powershell
& .\scripts\ensure-runtime-db-secrets.ps1 -EnvFile .\.env
```

Скрипт не змінює вже наявні валідні значення. Планову ротацію трьох role-секретів запускають тим самим скриптом із `-Rotate`, після чого одразу виконують повний deploy. `.env` не можна додавати до Git або копіювати в журнали.

## Реліз

Локальні `backups/` і `artifacts/` виключені з Docker build-контексту: ці приватні файли не потрібні образам і не повинні передаватися збірнику. Резервні копії залишаються на диску та перевіряються окремо до релізу.

Перед збиранням перевірте за зафіксованим `pnpm-lock.yaml` повний і production-аудит (`corepack pnpm audit --audit-level moderate` та `corepack pnpm audit --prod --audit-level high`). Після оновлення залежностей обов'язкові чиста збірка, перевірка типів, автоматичні тести й браузерна перевірка робочого кабінету та публічних маршрутів; сам успішний аудит не доводить сумісності релізу.

```sh
git fetch --all --prune
git checkout <approved-commit-or-tag>
chmod +x infra/scripts/*.sh
infra/scripts/deploy.sh
```

Скрипт спочатку перевіряє Compose, збирає образи, запускає залежності й виконує одноразовий `prisma migrate deploy` під owner-ідентичністю. Потім одноразовий `database_roles` створює або обертає non-owner ролі `autosale_api`, `autosale_worker` та read-only `autosale_backup`; тільки після цього стартують runtime-контейнери з окремими URL. Backup-роль має `BYPASSRLS`, бо повна disaster-recovery копія повинна містити всі tenant-рядки, але не має прав запису, DDL, виконання прикладних функцій або членства в runtime-ролях. Її пароль передається лише ефемерному tools-контейнеру під час backup. Якщо міграція або provisioning завершується помилкою, API та worker нової версії не розгортаються. Після успіху перевірте `docker compose ps`, `/health/live`, вхід менеджера та внутрішні `/metrics`.

Після першого auth-релізу створіть платформного адміністратора або прив'яжіть наявну організацію за процедурою [`authentication.md`](authentication.md). Bootstrap ніколи не запускається автоматично під час старту контейнерів.

## Tenant lifecycle rollout

Після міграції перевірте, що API і worker підключені різними non-owner ролями, а worker слухає чергу `tenant-lifecycle`. Безпечний smoke-test обмежується `EXPORT` для виділеної fictional-організації: дочекайтеся `EXPORT_READY`, перевірте metadata SHA-256/розмір, завантажте через step-up і скасуйте запит після перевірки. Не створюйте production `DELETE`-запит під час smoke-test — він одразу заморожує нові бізнес-мутації.

Артефакт приватний і після step-up передається як same-origin attachment через API; внутрішня адреса object storage та ключ об'єкта не потрапляють у браузер. Metadata завантаження очищається після семи днів. Для `FAILED` спочатку усуньте причину за безпечним кодом, потім використайте retry в admin UI; не додавайте довільні BullMQ retries. Для помилково замороженої організації скасуйте активну підготовку видалення та перевірте `CANCELLED`. Повний чекліст: [`../acceptance/tenant-data-lifecycle-checklist.md`](../acceptance/tenant-data-lifecycle-checklist.md).

## Публічний origin для Meta каналів

Для Instagram/Facebook OAuth і Meta webhook API читає тільки `APP_PUBLIC_URL`. До
запуску встановіть його у кореневому `.env` в точний публічний HTTPS origin та
перезапустіть API/стек. Дозволений OAuth callback завжди має вигляд
`<APP_PUBLIC_URL>/api/integrations/instagram/callback` для Instagram або
`<APP_PUBLIC_URL>/api/integrations/facebook/callback` для Facebook, а спільний
webhook callback — `<APP_PUBLIC_URL>/webhooks/meta`.

Для локального тестування використовуйте призначений ngrok development domain
і тримайте Docker, комп'ютер та ngrok active. Для власного домену можна
використати named Cloudflare Tunnel: `cloudflared` створює вихідне з'єднання,
тому origin не потребує публічної IP-адреси або відкритого inbound port
forwarding. У поточному Compose тунель і Caddy спільно використовують мережу
`edge`; маршрут hostname має вести на `http://proxy:80`, **не** на host port.
Склад мереж навмисно вузький: `cloudflared` працює лише в `edge`, `proxy` — в
`edge` і `internal`, `web` — лише в ізольованій `internal`, а `api` і `worker` —
в `internal` та окремій неізольованій `provider_egress`. Остання потрібна для
вихідних DNS/HTTPS-запитів до Meta, Google, OpenAI та інших провайдерів;
`internal: true` сама по собі не має зовнішнього маршруту. `provider_egress`
не підключена до тунелю, proxy, web, PostgreSQL, Redis або MinIO. Не
підключайте API або worker до `edge`: це відкриває прямий обхід Caddy для
контейнерів цієї мережі й суперечить межі довіри `trust proxy` в API.
Перевіряйте конфігурацію скриптом
`infra/scripts/verify-edge-network-boundary.ps1`; після ручного мережевого
релізу запустіть його з `-Live`, щоб перевірити фактичні мережі контейнерів,
недоступність API/worker напряму з `edge`, вихідний DNS із API/worker та
здоровий маршрут через proxy.
Caddy публікує 80/443 тільки на `127.0.0.1` для локальних перевірок. Не
відкривайте ці порти для LAN/Internet і не спрямовуйте інший контейнер на
`host.docker.internal:80`: loopback-binding не гарантує доступ із контейнера.
Перед зміною binding перевірте всі додаткові тунелі; застарілі Quick Tunnel
зупиніть або переналаштуйте на `proxy:80` у тій самій Docker-мережі.

Після зміни домену оновіть **і** Meta redirect URI, **і** Meta webhook
callback, потім повторіть webhook verification та приймальний OAuth-тест.
Детальні runbooks: [`../integrations/meta-instagram-oauth.md`](../integrations/meta-instagram-oauth.md)
та [`../integrations/meta-facebook-messenger.md`](../integrations/meta-facebook-messenger.md).

`FACEBOOK_MESSENGER_ENABLED` за замовчуванням має залишатися `false`. Для
контрольованої перевірки ввімкніть його одночасно в API і worker, виконайте
міграції, перевірте health та лише тоді під'єднайте тестову Page. Швидкий
відкат — повернути прапорець у `false` в обох сервісах і перезапустити їх;
збережені підключення та діалоги не видаляються.

## Google OAuth і приватні таблиці

У production використовується один Google Cloud застосунок AutoSale для всіх клієнтів. Кожен власник організації входить у власний Google-акаунт у Settings і через Picker дозволяє доступ лише до обраних ним файлів. Він не вводить Client ID, Client Secret або JSON-ключ.

Перед релізом:

1. Увімкніть Google Sheets API, Google Drive API та Google Picker API.
2. Налаштуйте OAuth consent screen, verified domain `sales-aito.com`, homepage, Privacy Policy і Terms.
3. Додайте origin `https://sales-aito.com` і callback `https://sales-aito.com/api/integrations/google/callback`.
4. Обмежте Picker API key точним production origin та Google Picker API.
5. Задайте `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` і `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` через deployment secrets/environment.
6. Не задавайте `GOOGLE_SERVICE_ACCOUNT_FILE` для production tenant operations.

Після зміни публічного домену одночасно оновіть callback у Google Console і `GOOGLE_OAUTH_REDIRECT_URI`. Повний checklist: [`../integrations/google-oauth-setup.md`](../integrations/google-oauth-setup.md).

## Відкат

Перейдіть на попередній перевірений Git tag і повторно запустіть deploy. Міграції БД мають бути backward-compatible; автоматичного downgrade Prisma немає. Якщо реліз містить несумісну міграцію даних, відновіть backup у контрольоване вікно за процедурою `backup-restore.md`.

Не копіюйте `.env`, OpenAI/Meta ключі чи Google JSON у Git, Docker image або CI artifacts.

## Комплектація та Telegram-сповіщення

- Worker також читає `APP_PUBLIC_URL`: він формує лише безпечне посилання на замовлення в особистому Telegram-сповіщенні.
- Після additive-міграції старі підтверджені замовлення з позиціями `UNASSESSED` обробляються пакетами до 25, від найстарішого. Повторний запуск безпечний.
- До передачі постачальнику менеджер перевіряє кожну позицію: `Є на складі` або `Треба замовити`. У Telegram постачальнику потрапляють тільки позиції `TO_ORDER`.
- Персональні сповіщення не містять ПІБ, телефону чи адреси клієнта. Користувач окремо керує трьома типами подій у **Налаштування → Telegram**.
- Після релізу перевірте метрики `procurement_assessment`, `procurement_transition`, `telegram_supplier_delivery` та `telegram_personal_alert`; дозволені лише обмежені значення `result`.
- Для відкату вимкніть worker попередньої версії перед запуском старого образу. Additive-поля та вже створені резерви залишаються в БД; не видаляйте їх вручну.


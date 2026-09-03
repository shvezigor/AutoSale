# Розгортання AutoSale на Linux Docker host

## Вимоги

- Linux x86_64/arm64, Docker Engine із Compose v2, Git і щонайменше 4 ГБ RAM.
- DNS домену спрямований на сервер; відкриті лише TCP 80/443 і адміністративний SSH.
- Репозиторій розгорнутий під окремим системним користувачем без root-login.
- `.env` створений із `.env.example`. Для tenant Google Sheets використовується OAuth; service-account JSON дозволений лише як тимчасовий development fallback і не потрібен у production.

## Реліз

```sh
git fetch --all --prune
git checkout <approved-commit-or-tag>
chmod +x infra/scripts/*.sh
infra/scripts/deploy.sh
```

Скрипт спочатку перевіряє Compose, збирає образи, запускає залежності й виконує одноразовий `prisma migrate deploy`. Якщо міграція завершується помилкою, API та worker нової версії не розгортаються. Після успіху перевірте `docker compose ps`, `/health/live`, вхід менеджера та внутрішні `/metrics`.

Після першого auth-релізу створіть платформного адміністратора або прив'яжіть наявну організацію за процедурою [`authentication.md`](authentication.md). Bootstrap ніколи не запускається автоматично під час старту контейнерів.

## Публічний origin для Meta Instagram

Для Instagram OAuth і Meta webhook API читає тільки `APP_PUBLIC_URL`. До
запуску встановіть його у кореневому `.env` в точний публічний HTTPS origin та
перезапустіть API/стек. Дозволений OAuth callback завжди має вигляд
`<APP_PUBLIC_URL>/api/integrations/instagram/callback`, а webhook callback —
`<APP_PUBLIC_URL>/webhooks/meta`.

Для локального тестування використовуйте призначений ngrok development domain
і тримайте Docker, комп'ютер та ngrok active. Для власного домену можна
використати named Cloudflare Tunnel: `cloudflared` створює вихідне з'єднання,
тому origin не потребує публічної IP-адреси або відкритого inbound port
forwarding. Поточний Compose публікує Caddy на host port 80; для тунелю
спрямуйте його на `http://localhost:80` і заблокуйте зовнішній TCP 80/443
firewall-ом (або змініть binding на loopback).

Після зміни домену оновіть **і** Meta redirect URI, **і** Meta webhook
callback, потім повторіть webhook verification та приймальний OAuth-тест.
Детальний runbook: [`../integrations/meta-instagram-oauth.md`](../integrations/meta-instagram-oauth.md).

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


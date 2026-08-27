# Розгортання AutoSale на Linux Docker host

## Вимоги

- Linux x86_64/arm64, Docker Engine із Compose v2, Git і щонайменше 4 ГБ RAM.
- DNS домену спрямований на сервер; відкриті лише TCP 80/443 і адміністративний SSH.
- Репозиторій розгорнутий під окремим системним користувачем без root-login.
- `.env` створений із `.env.example`; `secrets/google-service-account.json` доставлений окремим захищеним каналом і має права `0600`.

## Реліз

```sh
git fetch --all --prune
git checkout <approved-commit-or-tag>
chmod +x infra/scripts/*.sh
infra/scripts/deploy.sh
```

Скрипт спочатку перевіряє Compose, збирає образи, запускає залежності й виконує одноразовий `prisma migrate deploy`. Якщо міграція завершується помилкою, API та worker нової версії не розгортаються. Після успіху перевірте `docker compose ps`, `/health/live`, вхід менеджера та внутрішні `/metrics`.

Після першого auth-релізу створіть платформного адміністратора або прив'яжіть наявну організацію за процедурою [`authentication.md`](authentication.md). Bootstrap ніколи не запускається автоматично під час старту контейнерів.

## Відкат

Перейдіть на попередній перевірений Git tag і повторно запустіть deploy. Міграції БД мають бути backward-compatible; автоматичного downgrade Prisma немає. Якщо реліз містить несумісну міграцію даних, відновіть backup у контрольоване вікно за процедурою `backup-restore.md`.

Не копіюйте `.env`, OpenAI/Meta ключі чи Google JSON у Git, Docker image або CI artifacts.


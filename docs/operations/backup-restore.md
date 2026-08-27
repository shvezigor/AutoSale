# Backup і відновлення AutoSale

## Що зберігається

- PostgreSQL: conversations, messages, orders, audit і export state у custom-format dump.
- MinIO: копії вкладень Instagram.
- Маніфест із Git commit, Compose/Caddy-конфігурація та SHA-256 контрольні суми.

Redis, Caddy certificates і секрети не входять до backup: під час restore Redis очищається, а незавершені Google exports знову підбираються зі стану PostgreSQL; TLS перевидає Caddy, а секрети переносяться окремим зашифрованим каналом. Рекомендована політика: щоденний backup, локальне зберігання 14 днів, зашифрована off-host копія щонайменше 30 днів.

## Створення

```sh
chmod +x infra/scripts/*.sh
BACKUP_ROOT=/srv/autosale-backups RETENTION_DAYS=14 infra/scripts/backup.sh
```

Після створення синхронізуйте каталог у приватне versioned object storage та перевірте контрольні суми. Не розміщуйте backup у публічному bucket.

## Відновлення на чистому сервері

1. Встановіть Docker/Git, checkout commit із `manifest.txt` і створіть `.env` новими або відновленими секретами.
2. Скопіюйте backup у локальний абсолютний шлях і перевірте, що в ньому є `SHA256SUMS`, `postgres.dump`, `minio.tar.gz`.
3. Запустіть:

```sh
CONFIRM_RESTORE=autosale infra/scripts/restore.sh /srv/autosale-backups/20260827T090000Z
infra/scripts/deploy.sh
```

Restore навмисно вимагає абсолютний шлях і точне підтвердження, бо повністю замінює поточну БД та вміст MinIO.

## Перевірка після restore

- `docker compose ps` показує healthy API, worker, PostgreSQL, Redis і MinIO.
- Відкривається раніше збережена conversation з фото та order detail.
- Кількість замовлень і вкладень збігається з контрольним середовищем.
- Pending/failed Google export збережені й безпечно повторюються після повернення інтеграції.

Раз на квартал виконуйте test restore на окремому host/VM і записуйте дату, backup ID, Git commit, кількість перевірених записів та відповідального. Backup без успішного тесту відновлення не вважається перевіреним.

## Журнал перевірок

| Дата (UTC) | Середовище | Результат | Перевірені дані |
| --- | --- | --- | --- |
| 2026-08-27 | Ізольований Docker Compose project `autosale_restorecheck` | Успішно | SHA-256, 1 conversation, 1 order, 1 attachment, MinIO object, API/web HTTP 200, healthy API/worker |

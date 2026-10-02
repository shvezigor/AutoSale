# Backup і відновлення Sales AITO

## Що зберігається

- PostgreSQL: conversations, messages, orders, audit і export state у custom-format dump.
- MinIO: копії вкладень Instagram.
- Маніфест із Git commit, Compose/Caddy-конфігурація та SHA-256 контрольні суми.

Redis, Caddy certificates і секрети не входять до backup: під час restore Redis очищається, а незавершені Google exports знову підбираються зі стану PostgreSQL; TLS перевидає Caddy, а секрети переносяться окремим зашифрованим каналом. Рекомендована політика: щоденний backup, локальне зберігання до 14 днів, зашифрована приватна off-host копія до 30 днів. Після restore обов'язково повторно застосуйте tenant deletion ledger, щоб не повернути вже видалені персональні дані. Повна політика: [`data-protection-and-retention.md`](data-protection-and-retention.md).

## Створення

Перед першим backup виконайте звичайний deploy: одноразовий `database_roles` має створити `autosale_backup`, а `.env` — містити окремий `POSTGRES_BACKUP_PASSWORD`. Скрипт запускає `pg_dump` в ефемерному `database_backup` tools-контейнері. Контейнер отримує лише read-only backup-credential: він може прочитати всі tenant-рядки попри RLS, але не може змінювати БД, виконувати прикладні функції або створювати схему.

```sh
chmod +x infra/scripts/*.sh
BACKUP_ROOT=/srv/autosale-backups RETENTION_DAYS=14 infra/scripts/backup.sh
```

Після створення передайте каталог у приватне off-host object storage через Restic. Не розміщуйте backup у публічному bucket і не копіюйте незашифрований каталог звичайною синхронізацією.
Скрипт примусово використовує `umask 077`: нові архіви доступні лише користувачу, який їх створив. Off-host копія також має бути зашифрована, приватна та мати окремо контрольований ключ.
До завершення перевірок скрипт пише у прихований каталог `.incomplete-<timestamp>` і публікує timestamp-каталог лише атомарним перейменуванням. Наявність `.incomplete-*` означає невдалий backup; не використовуйте його для restore, дослідіть причину та видаліть окремим контрольованим кроком.

Не передавайте `POSTGRES_BACKUP_PASSWORD` API, worker або стороннім backup-сервісам. Компрометація цієї ролі розкриває дані всіх tenant-ів, хоча й не дозволяє їх змінити. Ротуйте секрет через `ensure-runtime-db-secrets.ps1 -Rotate` або еквівалентний secret-manager workflow і одразу повторно запускайте `database_roles`.

## Зашифрована off-host копія

Реальне S3-сховище навмисно не створюється на поточному host. Його підключення відкладено до запланованої міграції на Hetzner і виконується після provisioning нового host, але до production cutover. Детальний backlog, approval gates і порядок виконання зафіксовані в [`hetzner-production.md`](hetzner-production.md#deferred-backlog-activate-encrypted-off-host-backups-during-migration). До успішного encrypted snapshot та незалежної restore-перевірки перемикати production-трафік не можна.

Підтримуваний transport — Restic 0.19.1 або новіший сумісний реліз із приватним S3-compatible repository в EU/EEA. Restic шифрує й автентифікує вміст до відправлення. Bucket повинен блокувати public access, використовувати TLS, окрему least-privilege identity та lifecycle для incomplete multipart uploads. Якщо bucket versioning увімкнено, його non-current versions також мають окремо видалятися не пізніше 30 днів; інакше Restic retention не гарантує фізичне закінчення строку старих версій.

Зберігайте конфігурацію поза checkout, наприклад у `/etc/sales-aito/restic.env` з правами `0600`, а довгу випадкову repository password — в окремому `/etc/sales-aito/restic-password` з правами `0600`. Файл конфігурації містить лише operator-side значення:

```text
RESTIC_REPOSITORY=s3:https://<private-eu-endpoint>/<bucket>/sales-aito
RESTIC_PASSWORD_FILE=/etc/sales-aito/restic-password
AWS_ACCESS_KEY_ID=<backup-only identity>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_DEFAULT_REGION=<eu-region>
```

Не додавайте ці файли до `.env` застосунку, Git, CI artifacts або журналів. Збережіть незалежну recovery-копію repository password у схваленому password manager; без неї backup неможливо розшифрувати.

Перший `init` виконується один раз і тільки після ручної перевірки endpoint/bucket. Routine-скрипт навмисно не створює repository автоматично, щоб помилка в адресі не виглядала як успішний backup:

```sh
set -a
. /etc/sales-aito/restic.env
set +a
restic init
```

Щоденна операція спочатку створює application-consistent локальний backup, а потім завантажує останній завершений timestamp-каталог, перевіряє `SHA256SUMS`, утримує щонайменше останній snapshot і всі snapshots за 30 днів, виконує prune та `restic check`:

```sh
cd /srv/autosale
set -a
. /etc/sales-aito/restic.env
set +a
BACKUP_ROOT=/srv/autosale-backups RETENTION_DAYS=14 infra/scripts/backup.sh
BACKUP_ROOT=/srv/autosale-backups OFFSITE_RETENTION_DAYS=30 infra/scripts/offsite-backup.sh
```

Успіх фіксується локально в `/srv/autosale-backups/.offsite-last-success` без repository URL або credentials. Наявність свіжого файлу не замінює alert на exit code та максимальний вік backup. Запуски серіалізуйте одним host lock; не запускайте backup, prune і restore drill одночасно.

Приклад cron-розкладу для окремого deploy-користувача: daily backup о 02:15 UTC і квартальний restore drill о 03:30 UTC першого дня січня, квітня, липня та жовтня. Команди мають виконуватися через root-owned wrapper, який завантажує `/etc/sales-aito/restic.env`, використовує `flock` і надсилає ненульовий exit code в alerting. Не вставляйте credentials безпосередньо в crontab.

Відтворюваний чекліст і поточний стан live-перевірки: [`../acceptance/offsite-backup-restore-checklist.md`](../acceptance/offsite-backup-restore-checklist.md).

## Відновлення на чистому сервері

1. Встановіть Docker/Git, checkout commit із `manifest.txt` і створіть `.env` новими або відновленими секретами.
2. Скопіюйте backup у локальний абсолютний шлях і перевірте, що в ньому є `SHA256SUMS`, `postgres.dump`, `minio.tar.gz`.
3. Запустіть:

```sh
CONFIRM_RESTORE=autosale infra/scripts/restore.sh /srv/autosale-backups/20260827T090000Z
infra/scripts/deploy.sh
```

Restore навмисно вимагає абсолютний шлях і точне підтвердження, бо повністю замінює поточну БД та вміст MinIO. Read-only `autosale_backup` для restore не використовується: відновлення виконується owner-ідентичністю лише в одноразовому операторському процесі, коли API/worker зупинені. Owner credential не передається runtime- або backup-контейнерам.

## Перевірка після restore

- `docker compose ps` показує healthy API, worker, PostgreSQL, Redis і MinIO.
- Відкривається раніше збережена conversation з фото та order detail.
- Кількість замовлень і вкладень збігається з контрольним середовищем.
- Pending/failed Google export збережені й безпечно повторюються після повернення інтеграції.

Раз на квартал виконуйте test restore на окремому host/VM і записуйте дату, backup ID, Git commit, кількість перевірених записів та відповідального. Backup без успішного тесту відновлення не вважається перевіреним.

Для автоматизованої ізольованої вправи на backup-host із Docker виконайте:

```sh
set -a
. /etc/sales-aito/restic.env
set +a
CONFIRM_OFFSITE_RESTORE_DRILL=sales-aito \
  RESTORE_DRILL_ROOT=/srv/autosale-restore-drills \
  infra/scripts/verify-offsite-restore.sh
```

Скрипт завантажує й розшифровує останній snapshot у тимчасовий каталог, перевіряє `SHA256SUMS` і MinIO archive, відновлює PostgreSQL dump у тимчасовий `postgres:17.6-alpine`, звіряє лише кількість public-таблиць і міграцій та завжди видаляє container і plaintext-каталог. Він не підключається до production PostgreSQL/MinIO і не виводить customer data. Для квартального EU gate все одно потрібен окремий host/VM; запуск на тому самому failure domain є лише preflight.

## Журнал перевірок

| Дата (UTC) | Середовище | Результат | Перевірені дані |
| --- | --- | --- | --- |
| 2026-08-27 | Ізольований Docker Compose project `autosale_restorecheck` | Успішно | SHA-256, 1 conversation, 1 order, 1 attachment, MinIO object, API/web HTTP 200, healthy API/worker |
| 2026-09-23 | Тимчасові контейнери без мережі, backup `20260923T084613Z` | Успішно | SHA-256, PostgreSQL `pg_restore --exit-on-error` (56 таблиць), розпакування MinIO (40 файлів). Окрема локальна копія на диску D: перевірена; off-host копії ще немає. |
| 2026-10-01 | Ізольований PostgreSQL 17.6 без мережі, restricted-role backup `20261001T202729Z` | Успішно | Dump створено `autosale_backup`, SHA-256 і custom-format перевірено, `pg_restore --exit-on-error` відновив 56 таблиць і 59 міграцій; контрольні counts замовлень та вкладень звірені без читання персональних полів. |

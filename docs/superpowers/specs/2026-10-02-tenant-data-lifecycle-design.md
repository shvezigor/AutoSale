# Життєвий цикл даних компанії: експорт, замороження та безпечне видалення

## Мета

Sales AITO має надати контрольований адміністративний процес для перенесення та видалення всіх даних окремої компанії (`tenant`) без ризику випадково видалити іншу компанію, залишити активні інтеграції або повернути вже видалені дані після відновлення резервної копії.

Ця специфікація описує цільову архітектуру та перший безпечний етап. На першому етапі реалізуються експорт, окремий стан замороження нового приймання даних і retention dry-run. Фізичне видалення даних, автоматичне виконання retention-політик та replay журналу видалень після disaster restore залишаються вимкненими до окремого acceptance gate.

## Для кого цей функціонал

- Основний оператор — перевірений `PLATFORM_ADMIN` Sales AITO.
- Власник компанії не отримує кнопку миттєвого самовидалення в першій версії.
- Запит власника на доступ, перенесення або видалення даних проходить перевірку особи та повноважень поза цим технічним workflow, після чого оператор створює запит із безпечним кодом підстави.
- Звичайні менеджери компанії не бачать і не запускають lifecycle-операції.

## Погоджені принципи

1. Експорт, замороження і фізичне видалення є різними командами та різними станами.
2. `Tenant.status = BLOCKED` не використовується як ознака запиту на видалення. Цей статус уже означає адміністративне блокування доступу; змішування двох причин ускладнить відновлення і аудит.
3. Експорт сам по собі не зупиняє роботу компанії. Він формується з узгодженого snapshot стану на момент експорту.
4. Запит на видалення спочатку заморожує нові бізнес-мутації та зовнішнє приймання даних, але залишає доступними адміністративний перегляд, експорт і контрольоване скасування запиту.
5. Фізичне видалення потребує окремого підтвердження після готового експорту. Підтвердження створення запиту не є підтвердженням видалення.
6. Секрети, токени, password hashes, session hashes, idempotency secrets і зашифровані provider credentials ніколи не входять до експорту.
7. Кожна команда є idempotent, а worker повторно читає авторитетні дані під tenant-контекстом перед будь-якою дією.
8. Retention спочатку працює тільки як dry-run: показує, що підпало б під політику, але нічого не видаляє.

## Межі першого етапу

### Входить

- операторський API для створення і перегляду запитів `EXPORT` та `DELETE`;
- окрема lifecycle-модель зі станами, lease, безпечними error codes та аудитом;
- узгоджений machine-readable export даних компанії;
- manifest об'єктів із SHA-256, розміром, MIME type та призначенням;
- приватне зберігання export artifact з обмеженим строком життя;
- замороження нових бізнес-мутацій для активного запиту `DELETE`;
- idempotent worker pipeline для формування експорту;
- retention dry-run зі зведенням за категоріями без customer content у логах;
- метрики, PostgreSQL isolation tests та операційна документація.

### Не входить до першого етапу

- фізичне видалення PostgreSQL-рядків або object-store keys;
- автоматичне відкликання provider credentials;
- автоматичний replay видалень після restore;
- автоматичне виконання retention-політик;
- self-service видалення компанії власником;
- юридичний інтерфейс для legal hold або визначення законної підстави;
- експорт у PDF, XLSX чи формат конкретного провайдера.

Ці пункти є наступними фазами тієї самої архітектури, а не окремими паралельними реалізаціями.

## Архітектура

### Обрано: окремий orchestration workflow

Lifecycle-запит є durable orchestration record. API створює запит, worker виконує довгі операції, а база даних зберігає стан, lease та результат. Такий підхід підтримує повтори, аудит, контроль конкурентності й майбутнє фізичне видалення без довгих HTTP-транзакцій.

### Відхилено: прямий `DELETE FROM tenants`

Каскад бази даних не відкликає зовнішні інтеграції, не перевіряє object storage, не створює переносимий експорт і не залишає мінімального доказу видалення. Одноетапне видалення також не дає безпечної точки зупинки.

### Відхилено: ручний CLI без durable state

CLI корисний для аварійного відновлення, але не повинен бути основним workflow. Без станів, idempotency та lease неможливо надійно пояснити, що було виконано після збою або повторного запуску.

## Доменна модель

### `TenantLifecycleRequest`

Tenant-owned таблиця з forced RLS:

- `id`, `tenantId`;
- `kind`: `EXPORT` або `DELETE`;
- `status`;
- `reasonCode`: обмежений перелік на кшталт `CONTROLLER_REQUEST`, `CONTRACT_TERMINATION`, `ADMINISTRATIVE_TEST`;
- `requestedByUserId`, `requestedAt`;
- `ingestionFrozenAt`, `cancelledAt`, `cancelledByUserId`;
- `exportObjectKey`, `exportSha256`, `exportSizeBytes`, `exportManifestVersion`, `exportReadyAt`, `exportExpiresAt`;
- `leaseId`, `leaseExpiresAt`, `attemptCount`, `nextAttemptAt`;
- `lastErrorCode`, `completedAt`, `createdAt`, `updatedAt`.

Вільний текст із персональними даними не зберігається. Для одного tenant дозволений лише один активний lifecycle-запит, що може змінювати стан або заморожувати приймання даних. Новий завершений `EXPORT` можна створити після попереднього.

### Стани

Спільні стани першого етапу:

`REQUESTED -> EXPORTING -> EXPORT_READY`

Додаткові переходи:

- `REQUESTED -> CANCELLED`;
- `EXPORTING -> FAILED`, після чого дозволений контрольований retry;
- `FAILED -> EXPORTING` через повторний claim;
- для `DELETE`: після створення одразу фіксується `ingestionFrozenAt`, але експорт проходить тим самим pipeline.

Зарезервовані цільові стани наступної фази:

`EXPORT_READY -> DELETE_CONFIRMATION_PENDING -> DELETING -> COMPLETED`

Стани фізичного видалення не можна встановити через API, доки rollout flag наступної фази вимкнений.

### `TenantDeletionLedger` — наступна фаза

Ledger не має foreign key до `Tenant`, бо повинен пережити видалення tenant. Мінімальний запис міститиме tenant UUID, lifecycle request UUID, код підстави, actor UUID без FK, час завершення, checksum експорту, результат очищення object storage/provider credentials і дату завершення backup-expiry window.

Runtime-ролі не отримають прямий доступ до ledger. Запис і replay виконуватимуться лише через вузькі security-definer functions із фіксованим `search_path`, перевіркою platform admin/restore authority та без повернення customer content.

## Експорт

### Формат

Artifact є версіонованим архівом:

- `manifest.json` — версія формату, tenant UUID, час snapshot, перелік dataset-файлів, кількість записів і SHA-256 кожного файлу;
- `data/*.jsonl` — tenant-owned записи за доменними наборами;
- `objects/manifest.jsonl` — object key, логічне призначення, MIME type, розмір і SHA-256;
- `README.json` — machine-readable пояснення версії та виключених секретних полів.

JSONL використовується замість одного великого JSON, щоб worker міг stream-ити дані та обмежувати пам'ять. Перший етап експортує manifest об'єктів, але не дублює медіафайли всередину архіву. Додавання binary bundle потребуватиме окремої оцінки розміру, строку зберігання та шифрування.

### Узгодженість

- PostgreSQL-частина формується з одного repeatable-read snapshot або з еквівалентної зафіксованої snapshot boundary.
- Object manifest фіксує ключі та checksum, що існували на цій boundary; зміни після snapshot належать наступному експорту.
- Worker читає tenant-owned таблиці лише всередині `withTenantTransaction`.
- Queue payload містить тільки `requestId` і routing `tenantId`; worker не довіряє payload як джерелу стану.

### Виключення

Не експортуються:

- password/session/OAuth/Telegram/provider secrets і hashes;
- encrypted credential blobs та ключовий матеріал;
- внутрішні lease IDs, retry internals і security-only evidence, якщо воно не належить merchant як controller;
- platform-wide audit, інші tenants і системні backup records.

Export manifest явно перелічує виключені категорії, але не їхні значення.

### Зберігання і доступ

- object key використовує окремий приватний prefix, наприклад `tenant-lifecycle/<tenantId>/<requestId>/export.zip`;
- bucket/prefix не є публічним;
- API повертає тільки короткоживучий signed download URL після повторної перевірки platform admin;
- базовий строк життя artifact — 7 днів, після чого cleanup видаляє файл і очищає download metadata, зберігаючи checksum та audit result;
- логи й метрики не містять signed URL, object key, імена клієнтів або вміст експорту.

## Замороження приймання даних

Активний `DELETE` із `ingestionFrozenAt` утворює окремий tenant lifecycle gate. Він не змінює `Tenant.status`.

Gate відхиляє нові бізнес-мутації з локалізованим кодом `TENANT_LIFECYCLE_FROZEN`, зокрема:

- нові Meta/Instagram і Telegram inbound events після встановленої boundary;
- ручні повідомлення, нові або змінені замовлення, catalogue sync/import;
- нові supplier dispatch, Sheets export, delivery create/cancel і notification sends;
- зміни команди, правил замовлень, юридичних осіб/рахунків і підключень Meta, Google та перевізників;
- scheduled reconciliation, якщо воно створює новий зовнішній side effect.

Gate дозволяє:

- читання для перевіреного platform admin;
- формування і завантаження експорту;
- cleanup/revocation дії lifecycle workflow;
- ідемпотентне завершення зовнішньої операції, яка була підтверджена провайдером до freeze boundary, якщо її зупинка створить неконсистентність;
- скасування lifecycle-запиту до початку фізичного видалення.

Provider callback під час freeze отримує успішну технічну відповідь там, де повтор провайдера не має сенсу, але payload не нормалізується у бізнес-дані. Мінімальна технічна ознака відхилення може зберігатися без message body для операційного доказу.

Скасування `DELETE` прибирає lifecycle gate тільки якщо фізичне видалення ще не почалося. Воно не змінює незалежний `Tenant.status`; якщо tenant був адміністративно `BLOCKED`, він залишається заблокованим.

Authenticated API повторно читає gate всередині тієї самої tenant-транзакції, що й запис. Конфлікт мапиться глобально в безпечну відповідь `409` із кодом/повідомленням `TENANT_LIFECYCLE_FROZEN`; field validation для нього не застосовується. Телеметрія використовує лише обмежені `surface` та `safe_reason=lifecycle_frozen`. Read-only endpoints і особисті зміни профілю/пароля не блокуються.

## API, права та аудит

Перший етап додає platform-admin endpoints:

- `GET /admin/tenant-lifecycle` — список запитів із безпечними статусами;
- `GET /admin/tenant-lifecycle/:requestId` — деталі одного запиту;
- `POST /admin/tenants/:tenantId/lifecycle-exports` — створити `EXPORT`;
- `POST /admin/tenants/:tenantId/lifecycle-deletions` — створити `DELETE`, заморозити приймання і запустити експорт;
- `POST /admin/tenant-lifecycle/:requestId/cancel` — скасувати до destructive boundary;
- `POST /admin/tenant-lifecycle/:requestId/retry` — повторити retryable failure;
- `POST /admin/tenant-lifecycle/:requestId/download` — отримати короткоживучий signed URL;
- `POST /admin/retention/dry-runs` — сформувати retention preview.

Усі mutation endpoints вимагають CSRF, idempotency key, активного `PLATFORM_ADMIN` і свіжої повторної автентифікації для `DELETE`. Вони записують platform security audit із tenant ID, request ID, actor ID, safe reason/status code і часом. Customer content, URL, secrets та archive metadata у security audit не потрапляють.

Lifecycle table залишається tenant-protected. Platform API використовує вузькі authority functions, які повертають або змінюють лише routing IDs і lifecycle metadata. Прямий `BYPASSRLS` для API/worker не додається.

## Retention dry-run

Перший етап не видаляє записи. Scheduled або ручний dry-run:

1. читає затверджені категорії й строки з операційної retention-конфігурації;
2. знаходить тільки кандидатів старших за cutoff;
3. враховує lifecycle freeze і майбутній legal-hold marker;
4. повертає кількість, найстарішу дату та орієнтовний обсяг за tenant/category;
5. зберігає summary і safe reason codes, але не IDs клієнтів, тексти повідомлень чи адреси;
6. не ставить delete jobs і не змінює рядки.

Якщо policy для категорії не налаштована або має неоднозначну legal basis, категорія отримує `POLICY_NOT_CONFIGURED` і пропускається. Відсутність policy ніколи не означає «видалити негайно».

## Конкурентність, повтори та відновлення

- Partial unique index не дозволяє два активні destructive lifecycle-запити для одного tenant.
- Claim використовує статус, lease ID та lease expiry; завершення за простроченим lease відхиляється.
- Повтор API з тим самим idempotency key і payload повертає існуючий request; інший payload дає conflict.
- Archive публікується тільки після завершення upload і checksum verification: тимчасовий object key не стає доступним для download.
- Помилка dataset або object manifest робить весь export `FAILED`; частковий export не позначається готовим.
- Після restart worker продовжує expired lease без дублювання request або готового artifact.
- У наступній фазі restore runbook зобов'язаний replay-нути `TenantDeletionLedger` до запуску runtime services. Перший етап лише резервує контракт і не змінює процедуру restore.

## Помилки та операторський UX

Platform admin бачить лише локалізовані безпечні коди:

- tenant не знайдено або вже має активний request;
- request не можна скасувати/повторити в поточному стані;
- snapshot/export/object manifest не вдалося створити;
- artifact прострочений або checksum не пройшов;
- lifecycle gate не підтверджений усіма необхідними subsystems;
- retention policy відсутня або заблокована hold-позначкою.

Невідомі server/provider помилки залишаються на рівні форми/операції. Сирі SQL, S3, Prisma, Zod або provider messages не повертаються. Async-кнопки використовують `LoadingButton`, destructive дії — shared `danger-button`, інші — відповідний shared variant.

## Телеметрія

Метрики мають bounded labels:

- lifecycle requests за `kind`, `status`, `safe_result_code`;
- export duration і bytes у histogram без tenant ID label;
- freeze-gate rejects за `surface` і `safe_reason`;
- retention dry-run candidate counts за `category`;
- cleanup прострочених artifacts.

Tenant ID, request ID, object key, customer IDs і content допускаються тільки у контрольованому audit record, але не як metric labels або звичайний application log context.

## Тестування

### Контракти й домен

- допустимі переходи станів і заборонені destructive transitions першої фази;
- idempotency replay/conflict;
- retry, cancellation і lease expiry;
- export allowlist та обов'язкове виключення секретних полів;
- stable manifest version і checksum.

### PostgreSQL

- forced RLS для lifecycle request;
- відсутній tenant context читає нуль рядків;
- cross-tenant read/write відхиляються;
- partial unique active-request constraint;
- authority functions доступні тільки потрібній runtime-ролі й повертають bounded metadata;
- API та worker не отримують доступ до майбутнього deletion ledger.

### API та worker

- тільки platform admin може створити, переглянути, скасувати, retry або download;
- `DELETE` вимагає re-authentication і одразу створює freeze boundary;
- worker повторно читає request під tenant transaction;
- повтор job не створює другий artifact;
- частковий upload не публікується;
- signed URL не зберігається в логах або audit;
- artifact expiry видаляє object і блокує download.

### Регресія freeze gate

- Instagram, Telegram, catalogue, orders, suppliers, Google Sheets, delivery і notifications не створюють нових business side effects після freeze boundary;
- provider callback не утворює порожнього повідомлення або замовлення;
- незалежний адміністративний `BLOCKED` не скидається при cancel lifecycle request;
- звичайний `EXPORT` не заморожує tenant.

### Retention

- dry-run нічого не видаляє навіть при великій кількості кандидатів;
- категорія без policy пропускається fail-closed;
- summary не містить customer content;
- pagination/lease не дублюють candidate count.

## Rollout

1. Додати additive schema, state machine, RLS і authority functions без увімкнених endpoint mutations.
2. Додати export worker та artifact cleanup; перевірити на tenant із виключно фіктивними даними.
3. Увімкнути `EXPORT` для platform admin і виконати checksum/restore-readability acceptance.
4. Додати freeze gate за subsystem та довести regression matrix.
5. Увімкнути `DELETE` лише до стану `EXPORT_READY`; фізичне видалення залишається неможливим.
6. Увімкнути retention dry-run та зібрати щонайменше один повний звіт без mutations.
7. Лише після окремої специфікації й acceptance реалізувати credential revocation, object/database deletion, deletion ledger та restore replay.

Rollout не змінює існуючі tenants і не створює lifecycle requests автоматично. Відкат застосунку залишає additive таблиці невикористаними; destructive down migration у production не виконується.

## Критерії готовності першого етапу

- platform admin може створити `EXPORT` і отримати checksum-verified machine-readable artifact;
- export доведено не містить визначених secret categories;
- `DELETE` заморожує всі перелічені ingestion/side-effect surfaces, формує export і зупиняється на `EXPORT_READY`;
- cancel до destructive boundary відновлює lifecycle gate без зміни незалежного tenant access status;
- retention dry-run формує безпечний звіт і не виконує жодного delete;
- RLS, runtime grants, retries, audit, metrics і artifact expiry підтверджені тестами;
- фізичне видалення неможливо запустити конфігурацією або API першої фази.

## Наступні фази

1. Provider credential revocation, скасування queued actions і перевірене видалення object-store keys.
2. Явне повторне підтвердження, фізичний database cascade та мінімальний `TenantDeletionLedger`.
3. Обов'язковий ledger replay після restore і автоматизована перевірка backup-expiry window.
4. Конфігуроване виконання retention-політик із legal hold, preview/approval і поетапним rollout.
5. Owner-facing request intake після юридичного погодження DPA, privacy notice і процедури перевірки особи.

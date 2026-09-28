# Вимоги ЄС до ізоляції, зберігання та видалення даних у Sales AITO

**Дата перевірки:** 28 вересня 2026 року
**Статус документа:** юридико-технічне дослідження для планування продукту. Це не індивідуальна юридична консультація. Перед виходом на ринок ЄС модель ролей, строки зберігання, DPA, трансфери та тексти договорів має перевірити юрист у релевантній юрисдикції.

## Короткий висновок

1. GDPR **не вимагає окремої бази чи окремих таблиць для кожного клієнта** і не вимагає зберігати всі персональні дані виключно в ЄС/ЄЕЗ. Shared-database модель із `tenantId` допустима, якщо Sales AITO може довести надійну ізоляцію, мінімізацію доступу, безпеку, видалення та виконання прав суб'єктів даних.
2. Для діалогів, замовлень, адрес, телефонів і медіа магазин зазвичай визначає мету й засоби обробки та є **контролером**, а Sales AITO обробляє дані за його документованими інструкціями як **процесор**. Для облікових записів Sales AITO, безпеки сервісу, власного білінгу та обов'язкової звітності Sales AITO може бути окремим контролером. Роль визначається не назвою договору, а фактичним рішенням про мету й засоби кожної операції.
3. Немає єдиного строку на кшталт «усі дані зберігати 5 років». Контролер повинен мати правову підставу, зберігати кожну категорію даних не довше, ніж потрібно для заявленої мети або обов'язкового національного строку, та встановити строки видалення або перегляду.
4. EU/EEA hosting є найпростішим і найменш ризиковим варіантом, але не самостійною вимогою GDPR. Будь-який доступ або передача за межі ЄЕЗ потребує перевірки механізму глави V GDPR: рішення про адекватність або відповідних гарантій, найчастіше SCC, оцінки трансферу й за потреби додаткових заходів.
5. Окрім GDPR, до Sales AITO **ймовірно може застосовуватися глава VI Data Act** як до SaaS/data processing service. Вона діє з 12 вересня 2025 року і вимагає договірного та технічного механізму перенесення експортованих даних, періоду отримання даних і повного видалення після завершення переходу. Остаточну кваліфікацію конкретної пропозиції Sales AITO треба підтвердити з юристом.

## 1. Коли GDPR застосовується

GDPR застосовується до організації, встановленої в ЄС, у межах діяльності її установи незалежно від фактичного місця обробки. Він також може застосовуватися до компанії поза ЄС, якщо вона цілеспрямовано пропонує товари чи послуги людям у ЄС або відстежує їхню поведінку в ЄС. Сам факт, що неєвропейський клієнт тимчасово перебуває в ЄС, без такого таргетування не обов'язково робить сервіс підпорядкованим GDPR. Джерела: [GDPR, стаття 3](https://eur-lex.europa.eu/eli/reg/2016/679), [Європейська комісія — Who does the data protection law apply to?](https://commission.europa.eu/law/law-topic/data-protection/reform/rules-business-and-organisations/application-regulation/who-does-data-protection-law-apply_en).

Для Sales AITO це означає:

- якщо сервіс починає продаватися магазинам в ЄС або явно обслуговує їхніх клієнтів у ЄС, GDPR слід вважати застосовним;
- якщо Sales AITO підпадає під статтю 3(2), але не має установи в ЄС, треба окремо перевірити обов'язок призначити представника в ЄС за статтею 27;
- GDPR поширюється на дані живих фізичних осіб. Назва юридичної особи сама по собі не є персональними даними, але ім'я ФОП, контактна особа, телефон, адреса, Instagram username, IP та зміст приватного листування можуть ними бути.

## 2. Ролі контролера та процесора

EDPB наголошує, що контролер визначає мету та основні засоби обробки, а процесор обробляє дані від імені контролера за його інструкціями. Ролі мають оцінюватися окремо для кожної операції, а не присвоюватися компанії один раз на всі випадки. Джерела: [EDPB Guidelines 07/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en), [EDPB guide — Data controller or data processor](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en).

### Робоча модель для Sales AITO

| Обробка | Імовірна роль магазину | Імовірна роль Sales AITO | Що потрібно |
|---|---|---|---|
| Instagram/інші діалоги, дані покупців, замовлення, доставка, платежі, робота з постачальниками | Контролер | Процесор | DPA за статтею 28, інструкції, конфігуровані строки, допомога з правами та інцидентами |
| Профіль користувача Sales AITO, автентифікація, власний білінг і договір | Окремий контролер своїх працівників | Контролер | Privacy notice, правова підстава, власні строки, права користувача |
| Захист сервісу, anti-abuse, технічний аудит | Потрібен аналіз конкретної мети | Може бути окремим контролером | Документована мета, мінімізація логів, balancing test де застосовується legitimate interest |
| Використання клієнтського контенту для навчання загальної AI-моделі або власної реклами | Не є звичайною інструкцією магазину | Sales AITO може стати контролером/спільним контролером | Не робити за замовчуванням; потрібні окрема мета, підстава, прозорість та юридична оцінка |

Як процесор Sales AITO повинен мати письмовий DPA, обробляти дані лише за документованими інструкціями, забезпечувати конфіденційність і безпеку, залучати subprocessors лише за передбаченою авторизацією, допомагати контролеру з правами, DPIA та інцидентами, допускати належний аудит, а після завершення послуг — на вибір контролера повернути або видалити персональні дані й копії, якщо закон не вимагає їх збереження. Джерело: [GDPR, стаття 28](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng/pdf).

## 3. Ізоляція клієнтів і модель shared database

Жодна з проаналізованих норм не встановлює database-per-tenant як обов'язкову архітектуру. GDPR встановлює результат: відповідний ризику рівень конфіденційності, цілісності, доступності й відновлюваності, а також регулярну перевірку заходів. Конкретний набір заходів залежить від ризику. Джерела: [GDPR, статті 25 і 32](https://eur-lex.europa.eu/eli/reg/2016/679), [EDPB Guidelines 4/2019 on data protection by design and by default](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en).

Shared tables із `tenantId` можуть відповідати GDPR, але лише application-level фільтр є слабкою єдиною межею. Для Sales AITO рекомендована defense-in-depth модель:

1. PostgreSQL Row Level Security або еквівалентна обов'язкова database-level tenant policy для всіх tenant-owned таблиць.
2. Tenant context отримується лише з перевіреної сесії/service identity; tenant ID із body/query/URL не може бути джерелом авторизації.
3. Composite foreign keys та unique constraints із `tenantId`, щоб неможливо було пов'язати записи різних компаній.
4. Автоматичні cross-tenant negative tests для API, workers, exports, media, background jobs і адміністративних функцій.
5. Least privilege для БД і object storage; окремі identities для API, worker, migrations і backups.
6. TLS у транзиті; шифрування дисків, object storage і backup; контроль ключів і їх ротації.
7. MFA для привілейованого доступу, RBAC, журнал адміністративних дій, регулярний review доступів.
8. Логи без message body, токенів, адрес та телефонів за замовчуванням; структуроване маскування й короткий retention.
9. Захист медіа tenant-scoped авторизацією або короткоживучими signed URLs; відсутність публічних постійних object URLs.
10. Регулярні restore drills, vulnerability/patch process, secret rotation, incident runbook і документований risk review.

Це **продуктова рекомендація**, а не твердження, що GDPR прямо називає RLS, MFA чи конкретний алгоритм шифрування. Стаття 32 вимагає адекватних ризику технічних та організаційних заходів, зокрема, де доречно, шифрування/псевдонімізацію, здатність відновлення та регулярне тестування. Окрема база на tenant може бути premium/enterprise опцією для контрактних вимог, але не потрібна як базова модель.

## 4. Строки зберігання

Стаття 5(1)(e) GDPR вимагає зберігати персональні дані у формі, що дозволяє ідентифікацію, не довше, ніж потрібно для мети. Комісія пояснює, що організація повинна визначити строки видалення або перегляду, враховуючи мету та обов'язкові національні строки, наприклад податкові, антифрод або гарантійні. Джерела: [GDPR, стаття 5](https://eur-lex.europa.eu/eli/reg/2016/679), [Європейська комісія — Principles of the GDPR, Storage limitation](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).

Отже, Sales AITO не повинен зашивати один юридичний строк для всіх клієнтів ЄС. Потрібна версіонована retention policy та конфігурація контролера за категоріями. Нижче — **не юридично встановлені строки**, а рекомендовані стартові product defaults, які клієнт має підтвердити з урахуванням законодавства своєї країни:

| Категорія | Рекомендований стартовий default | Поведінка |
|---|---:|---|
| Raw webhook payload | 7–30 днів | Видалити після нормалізації та завершення retry/розслідування |
| Черги, технічні delivery attempts, application logs | 30–90 днів | Не логувати body/credentials; довше лише security event з мінімальними даними |
| Скопійовані медіа з діалогів | 90–180 днів або строк діалогу | Налаштовується; видаляти раніше, якщо медіа не потрібне для замовлення/спору |
| Діалоги без замовлення | 12 місяців без активності | Налаштовується магазином; попередження перед purge |
| Діалоги та персональні дані, прив'язані до замовлення | Строк, заданий контролером | Відокремити обов'язковий order/audit record від зайвого message/media content |
| Замовлення, платежі, доставка | За національними договірними, податковими, бухгалтерськими та dispute строками контролера | Після завершення операційної мети мінімізувати або псевдонімізувати поля, якщо закон не вимагає повного набору |
| Security/admin audit | 12–24 місяці | Обґрунтувати ризиком; обмежити доступ; не дублювати контент |
| Tenant після завершення підписки | Export/retrieval window, потім production purge | Узгодити з Data Act та DPA; окремо визначити backup expiry |

Product requirements:

- для кожної категорії зберігати: мету, правову підставу/інструкцію, owner, строк або критерій, подію старту строку, виняток legal hold;
- автоматичні lifecycle jobs для purge/anonymisation із tenant-scoped audit evidence;
- configurable retention у кабінеті та API, але без дозволу встановити «назавжди» без окремого обґрунтування;
- legal hold має бути вузьким, мати причину, owner і строк review; він не повинен зупиняти видалення всього tenant;
- privacy notice і DPA мають називати строк або зрозумілий критерій для різних категорій, а не формулу «зберігаємо стільки, скільки потрібно» без пояснення.

## 5. Права суб'єктів даних і видалення

GDPR передбачає права на інформацію, доступ і копію, виправлення, видалення, обмеження, заперечення, переносимість та захист від певних виключно автоматизованих рішень. Запит на видалення не є абсолютним: дані можуть залишатися, якщо їх збереження необхідне, наприклад, для виконання правового обов'язку або встановлення, здійснення чи захисту правових вимог. Відповідь на запити за загальним правилом надається без невиправданої затримки та протягом одного місяця, з передбаченим GDPR продовженням для складних/численних запитів. Джерела: [GDPR, статті 12, 15–22](https://eur-lex.europa.eu/eli/reg/2016/679), [EDPB — Data subject rights](https://www.edpb.europa.eu/topics/key-gdpr-concepts/data-subject-rights_en), [EDPB Guidelines 01/2022 on the right of access](https://www.edpb.europa.eu/documents/guideline/guidelines-012022-on-data-subject-rights-right-of-access_en).

Sales AITO має надати магазину-контролеру інструменти:

- знайти людину за username/телефоном/email та зібрати всі пов'язані діалоги, замовлення, медіа й delivery records без даних іншого tenant;
- експортувати читабельну копію й, де застосовується, structured machine-readable data;
- виправити, обмежити, видалити або псевдонімізувати дані з урахуванням legal hold;
- зафіксувати запит, рішення, підставу відмови/часткового виконання, операції та одержувачів, яких треба повідомити;
- розділити видалення end-customer на запит магазину від видалення акаунта користувача Sales AITO, де Sales AITO є контролером.

### Резервні копії

Backup потрібен для доступності та відновлення за статтею 32, але не може бути безстроковим архівом. EDPB у звіті 2026 року описав практичний конфлікт: модифікація immutable backup не завжди безпечна або технічно доцільна, однак організація повинна мати процедуру, яка не дозволить видаленим записам «повернутися» після restore. Джерела: [EDPB 2025 Coordinated Enforcement report on the right to erasure, розділ 4.2.6](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf), [GDPR, статті 17, 28(3)(g), 32](https://eur-lex.europa.eu/eli/reg/2016/679).

Рекомендована модель:

1. Encrypted immutable backups із фіксованим коротким retention та автоматичним expiry; не використовувати їх як доступний аналітичний архів.
2. Tombstone/deletion ledger із мінімальним неперсональним або псевдонімізованим ідентифікатором, щоб restore pipeline повторно застосував усі видалення до повернення системи в production.
3. Відновлене середовище ізольоване; lifecycle jobs і deletion ledger запускаються до відкриття користувацького доступу.
4. DPA/privacy documentation чітко пояснює backup window і неможливість звичайного використання видалених даних із backup.
5. Після завершення backup retention копії фізично видаляються; restore drills перевіряють також «не воскресити видалене».

## 6. Безпека та інциденти

Стаття 32 покладає risk-based security obligations і на контролера, і на процесора. У разі personal data breach процесор повинен повідомити контролера без невиправданої затримки. Контролер повідомляє компетентний DPA без невиправданої затримки та, де можливо, не пізніше 72 годин від моменту, коли дізнався про інцидент, крім випадку, коли ризик для прав і свобод малоймовірний; при високому ризику може знадобитися також повідомлення людей. Усі breaches мають бути належно задокументовані. Джерела: [GDPR, статті 32–34](https://eur-lex.europa.eu/eli/reg/2016/679), [EDPB Guidelines 9/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en).

Практична вимога для Sales AITO:

- внутрішній incident SLA для processor-to-controller повідомлення має бути значно коротшим за 72 години; наприклад, початковий verified notice протягом 24 годин — це рекомендація, а не строк із GDPR;
- мати breach register, severity/risk assessment, containment, evidence preservation і шаблони повідомлень;
- інцидент tenant isolation або object URL слід вважати потенційним personal data breach навіть без підтвердження зловживання;
- DPA має визначити канали, контакти, мінімальний зміст notice і обов'язок subprocessors негайно інформувати Sales AITO.

DPIA потрібна, коли обробка, імовірно, створює високий ризик; стаття 35 називає, зокрема, систематичну та масштабну оцінку людей на основі автоматизованої обробки, масштабну обробку special-category data та масштабний систематичний моніторинг загальнодоступних місць. DPO не є автоматично обов'язковим для кожного малого SaaS; його необхідність оцінюється за статтею 37, зокрема за масштабною регулярною й систематичною поведінковою обробкою або масштабною обробкою special-category data. Джерело: [Європейська комісія — Obligations, DPIA and DPO](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en).

Для Sales AITO варто провести formal DPIA screening до виходу в ЄС, а DPIA — до запуску нової AI-функції, якщо вона створює high-risk profiling або solely automated decisions зі значним впливом. Проста допомога оператору у формуванні замовлення з людською перевіркою сама по собі не доводить наявність такого рішення.

## 7. Subprocessors і міжнародні передачі

Мінімальний subprocessor inventory для фактичної архітектури може включати hosting, backup/object storage, email, observability, AI model provider, Meta/Instagram, Google, Telegram, delivery carriers та support tooling. Для кожного треба задокументувати роль, категорії даних, мету, локації зберігання й support access, retention, deletion, security, incident notice і transfer mechanism.

Європейська комісія пояснює: передача за межі ЄЕЗ дозволяється на підставі рішення про адекватність або відповідних safeguards, зокрема SCC; для країни/одержувача без адекватності самих SCC може бути недостатньо без оцінки законодавства/практики третьої країни та додаткових технічних, договірних або організаційних заходів. Джерела: [Європейська комісія — Rules on international data transfers](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en), [актуальний перелік adequacy decisions](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en), [Commission SCC page](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en), [EDPB Recommendations 01/2020 on supplementary measures](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en).

Важливі наслідки:

- сервер у Німеччині з EU backups суттєво спрощує compliance, але Meta, Google, Telegram, AI API, support personnel або US-owned provider все одно можуть створювати окремий transfer/access analysis;
- «провайдер має EU region» недостатньо: треба перевірити DPA, subprocessors, disaster-recovery copies, telemetry, remote support та legal entity одержувача;
- для US recipients рішення про адекватність стосується лише організацій, що реально беруть участь в EU-US Data Privacy Framework; інакше потрібен інший інструмент;
- subprocessor list має бути доступним клієнту, а DPA — передбачати попередження про зміни та реальну можливість заперечити відповідно до погодженої процедури.

## 8. Data Act: export, switching і завершення сервісу

Data Act застосовується з 12 вересня 2025 року. Його визначення data processing service охоплює цифрову послугу з ubiquitous/on-demand network access до shared configurable, scalable and elastic computing resources; преамбула прямо відносить до моделей IaaS, PaaS і SaaS. Тому Chapter VI слід вважати **потенційно застосовним до комерційного Sales AITO SaaS**, хоча остаточну кваліфікацію та територіальну/договірну сферу має підтвердити юрист. Джерела: [Data Act, стаття 2(8) і глава VI](https://eur-lex.europa.eu/eli/reg/2023/2854/oj), [Європейська комісія — Data Act explained](https://digital-strategy.ec.europa.eu/en/factpages/data-act-explained).

Якщо глава VI застосовується, договір до підписання має чітко описувати switching; клієнт повинен мати можливість перенести exportable data і digital assets до іншого постачальника або on-premises. Стаття 25 встановлює, серед іншого, maximum transitional period 30 календарних днів, maximum notice period до двох місяців, перелік ported/exempt categories, мінімум 30 календарних днів для retrieval після transition та повне видалення exportable data після відповідного retrieval/узгодженого строку. Для SaaS також передбачені open interfaces і, щонайменше, export у commonly used machine-readable format; switching charges повністю скасовуються з 12 січня 2027 року. Джерела: [Data Act, статті 23–30](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A32023R2854), [Commission Data Act explained](https://digital-strategy.ec.europa.eu/en/factpages/data-act-explained).

Це окреме B2B право клієнта сервісу і не замінює GDPR portability/erasure прав конкретної фізичної особи. Для Sales AITO потрібні:

- повний tenant export: каталог, налаштування, conversations/messages, attachments manifest/files, orders/items, delivery, payment facts, audit і documented exclusions;
- versioned JSON/CSV та media archive із schema documentation і checksums;
- workflow `export requested → frozen snapshot → downloadable for retrieval period → purge scheduled → purge certificate`;
- письмові switching terms до укладення договору й онлайн-реєстр форматів/структур;
- узгодження Data Act retrieval window із GDPR storage limitation: дані не можна залишати безстроково лише тому, що існує export window.

## 9. DSA та інші акти

Digital Services Act не використовується в цьому документі як джерело вимог для нинішнього Sales AITO. Поточний продукт є приватним B2B SaaS для роботи з власними діалогами й замовленнями клієнта, а не публічним marketplace/social platform або сервісом розповсюдження user content невизначеному колу осіб. Це треба повторно оцінити, якщо з'являться публічні профілі, marketplace, публікація/пошук користувацького контенту чи інша intermediary/hosting функція. Це scope assessment, не остаточна юридична кваліфікація.

## 10. Рекомендований порядок реалізації

### P0 — до підключення реальних клієнтів ЄС

1. Data inventory і Record of Processing Activities: таблиця/об'єкти, категорія даних, purpose, role, legal basis/instruction, retention trigger, recipients, location, transfer mechanism.
2. DPA controller–processor, subprocessor list і change-notice process; privacy notice для даних, де Sales AITO є контролером.
3. EU/EEA primary hosting і backups; перевірка всіх зовнішніх доступів/трансферів, SCC/TIA де потрібно.
4. Посилити tenant boundary: database-level RLS, composite tenant constraints, cross-tenant automated tests, tenant-scoped object access.
5. Incident response, breach register, processor notification SLA, security access review і encrypted restore-tested backups.
6. Зафіксувати, що customer content не використовується для навчання загальної моделі без окремого рішення й підстави; перевірити DPA/retention AI provider.

### P1 — retention і права

1. Retention registry/policy та tenant settings за категоріями.
2. Automated purge/anonymisation, legal holds з expiry/review і audit evidence.
3. DSAR tooling: search, access/export, rectification, restriction, erasure, recipients log.
4. Backup expiry і deletion ledger, який повторно застосовується при restore.
5. Privacy UI/документи з конкретними строками або критеріями.

### P2 — Data Act і enterprise readiness

1. Повний machine-readable tenant export з documented schema, attachments і checksums.
2. Termination/switching workflow з retrieval window і доказовим purge certificate.
3. Online register форматів та switching terms.
4. Formal DPIA screening, DPO/Article 27 representative assessment, annual privacy/security review.
5. За потреби — dedicated database/region як enterprise contractual option, але не як заміна правильної shared-database безпеки.

## 11. Рішення, які має підтвердити юрист

- чи та коли Sales AITO таргетує EU data subjects і чи потрібен Article 27 representative;
- точний controller/processor split для security telemetry, fraud prevention, AI та support access;
- legal bases магазину для Instagram conversations, order fulfilment, marketing та подальших повідомлень;
- національні строки для замовлень, оплат, податків, гарантій і спорів у кожній країні клієнта;
- Data Act Chapter VI applicability та обов'язкові switching/contract terms для конкретної Sales AITO пропозиції;
- DPIA/DPO thresholds із урахуванням фактичного масштабу, profiling і special-category data;
- SCC modules, Transfer Impact Assessments та додаткові заходи для кожного non-EEA provider;
- взаємодія GDPR із законодавством України та іншими країнами, де працює Sales AITO або його клієнти.

## Офіційні джерела

- [Regulation (EU) 2016/679 (GDPR), EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679)
- [EDPB Guidelines 07/2020 on controller and processor](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en)
- [EDPB Guidelines 4/2019 on data protection by design and by default](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en)
- [EDPB Guidelines 01/2022 on right of access](https://www.edpb.europa.eu/documents/guideline/guidelines-012022-on-data-subject-rights-right-of-access_en)
- [EDPB Guidelines 9/2022 on breach notification](https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en)
- [EDPB Recommendations 01/2020 on supplementary transfer measures](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en)
- [European Commission — GDPR principles and storage limitation](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- [European Commission — international transfers](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)
- [European Commission — Standard Contractual Clauses](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en)
- [Regulation (EU) 2023/2854 (Data Act), EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/2854/oj)
- [European Commission — Data Act explained](https://digital-strategy.ec.europa.eu/en/factpages/data-act-explained)

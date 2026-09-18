# Аналіз хостингу Sales AITO: Hetzner Cloud, AWS і Google Cloud

**Дата перевірки:** 18 вересня 2026 року

**Ціль:** практичний старт для 50–100 активних користувачів в Україні з можливістю подальшого масштабування.
**Статус документа:** дослідження для вибору. Остаточну конфігурацію і вартість треба зафіксувати окремим ADR та повторно перевірити в офіційному калькуляторі безпосередньо перед замовленням.

## Короткий висновок

Для нинішнього етапу найкраще співвідношення ціни, переносимості та складності дає **Hetzner Cloud у Нюрнберзі або Фалькенштайні**:

- один x86-64 сервер `CPX32` (4 shared vCPU, 8 GB RAM, 160 GB NVMe) є мінімальною стартовою конфігурацією;
- практичніший production-варіант — 16 GB RAM або перенесення Docker build у CI/GHCR, бо складання Next.js і всіх Docker-образів на 8 GB хості може спричинити OOM;
- PostgreSQL, Redis і застосунок на першому етапі можна залишити self-hosted у Compose, але backups БД і S3-сумісне object storage мають зберігатися поза сервером;
- load balancer на одному application host не потрібен; він стає доцільним після появи щонайменше двох application hosts;
- AWS або Google Cloud варто обирати відразу лише тоді, коли важливіші за ціну керовані БД/Redis, multi-AZ, IAM, autoscaling та нижча операційна відповідальність команди.

**Google Cloud Warsaw (`europe-central2`)** — найсильніший cloud-native альтернативний варіант для української аудиторії: найближчий із порівнюваних повноцінних hyperscaler-регіонів і має Compute Engine, Cloud SQL та Memorystore. **AWS Frankfurt (`eu-central-1`)** — найзріліша екосистема і хороший довгостроковий варіант для складної інфраструктури, але для 50–100 користувачів її вартість і операційна поверхня зайві.

## Поточна інфраструктура Sales AITO

Sales AITO — це **не один контейнер**. `compose.yaml` запускає дев’ять сервісів на одному Docker-хості:

1. `web` — Next.js;
2. `api` — NestJS API;
3. `worker` — фонові BullMQ-процеси;
4. `migrate` — одноразове застосування Prisma migrations;
5. `postgres` — основна база даних і джерело істини;
6. `redis` — черги BullMQ, rate limiting і координація;
7. `minio` — S3-сумісне object storage;
8. `proxy` — Caddy/TLS/reverse proxy;
9. `cloudflared` — Cloudflare Tunnel.

Дані зберігаються у п’яти named volumes: PostgreSQL, Redis, MinIO та два Caddy volumes. Контейнери розділені на `edge` й закриту `internal` network. Застосунок уже відокремлює provider-neutral код від зовнішніх інтеграцій, використовує стандартні `DATABASE_URL`, `REDIS_URL` і S3-compatible variables. Тому переносимість між провайдерами добра: потрібен Linux Docker host, DNS/secrets, перенесення PostgreSQL та S3-об’єктів і перевірений restore.

Нинішні обмеження:

- усі runtime-компоненти і stateful сервіси залежать від одного VM/host;
- немає high availability, IaC, container registry та resource limits;
- CI перевіряє код, але deployment через SSH повторно збирає образи на production host;
- 8 GB достатньо як runtime-мінімум, але одночасний build може забрати пам’ять у PostgreSQL/Redis/worker;
- в API є багато module-level `createPrismaClient()`; перед горизонтальним масштабуванням треба централізувати DB provider, встановити connection pool limits і, за потреби, додати PgBouncer.

## Базова модель навантаження

Для 50–100 **активних користувачів**, якщо це не 100 одночасних AI/import jobs, стартова ціль така:

- 4 vCPU;
- 8 GB RAM runtime minimum, 16 GB safer if builds remain on-host;
- 80–160 GB системного SSD/block storage;
- PostgreSQL із щоденним логічним backup і регулярною перевіркою restore;
- Redis із невеликим dataset, бо PostgreSQL залишається джерелом істини, а BullMQ — механізмом доставки/пробудження;
- окреме S3-compatible object storage для media/imports/backups;
- один public entry point через Caddy або Cloudflare Tunnel;
- CPU, RAM, disk, queue depth, DB connections і job latency alerts.

Це інженерна початкова оцінка, а не гарантія місткості. Після запуску треба виміряти реальні webhook bursts, імпорти каталогів, AI job duration, DB connections і розмір медіа.

## Порівняння провайдерів

| Критерій | Hetzner Cloud | AWS | Google Cloud |
|---|---|---|---|
| Практична стартова локація | Nuremberg/Falkenstein, Germany; Helsinki як альтернатива | `eu-central-1`, Frankfurt | `europe-central2`, Warsaw; Frankfurt як альтернатива |
| Compute орієнтир | `CPX32`: 4 shared vCPU, 8 GB, 160 GB NVMe | EC2 compute-optimized/general-purpose instance; точний тип і ціну вибрати в calculator | custom E2 4 vCPU/8 GB або доступний general-purpose профіль; перевірити calculator |
| Прогнозованість | Висока: погодинна оплата з monthly cap, великий пакет EU traffic | Нижча: окремо EC2, EBS, IPv4, egress, snapshots/LB та інші SKUs | Середня: окремо VM, disk, IPv4, network/LB; billing granular |
| Managed PostgreSQL | Немає first-party cloud-managed PostgreSQL; self-host або зовнішній DBaaS | Amazon RDS for PostgreSQL | Cloud SQL for PostgreSQL |
| Managed Redis | Немає first-party managed Redis; self-host або зовнішній сервіс | ElastiCache/Valkey/Redis OSS | Memorystore for Redis/Valkey |
| Object storage | S3-compatible Hetzner Object Storage | Amazon S3 | Cloud Storage; застосунку потрібен S3 adapter/compatibility decision |
| HA/autoscaling | Є LB, networks, API, але HA stateful layer будує команда | Найповніший набір managed/multi-AZ/autoscaling | Повний managed stack і сильна регіональна присутність у Warsaw |
| Операційна складність | Найнижча для поточного Compose, але команда адмініструє БД/Redis/OS | Найвища через IAM/VPC/SG/EC2/EBS/RDS/ElastiCache/egress | Вища за Hetzner, зазвичай трохи простіша за повний AWS stack |
| Найкращий сценарій | Дешевий MVP/ранній production з контрольованим DevOps | Зріла multi-AZ платформа, compliance та великий масштаб | Managed platform, Warsaw latency і майбутнє використання GCP сервісів |

## 1. Hetzner Cloud

### Стартова конфігурація

**Мінімальна:**

- `CPX32`, Germany: 4 shared vCPU, 8 GB RAM, 160 GB NVMe;
- primary IPv4/IPv6;
- server Backups;
- Hetzner Object Storage у тій самій network zone `eu-central`;
- без окремого Load Balancer, доки application host один.

Офіційна зміна цін від 15 червня 2026 року вказує для `CPX32` у Germany/Finland **€35.49/місяць без VAT та без IPv4**. Primary IPv4 коштує **€0.50/місяць без VAT**, IPv6 безкоштовний. Backups коштують **20% ціни сервера** і надають сім backup slots. Object Storage має базову ціну **€4.99/місяць без VAT**, яка включає 1 TB storage і 1 TB egress. Таким чином, відомі базові компоненти `CPX32 + IPv4 + Backups + Object Storage` становлять приблизно **€48.08/місяць без VAT**, до додаткових volumes, excess usage і сторонніх сервісів. Це арифметичний орієнтир, не комерційна пропозиція; перед замовленням треба перевірити [актуальні cloud prices](https://www.hetzner.com/cloud/) і рахунок для країни платника. Джерела: [price adjustment 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [server overview](https://docs.hetzner.com/cloud/servers/overview/), [billing FAQ](https://docs.hetzner.com/cloud/billing/faq/), [Object Storage announcement](https://www.hetzner.com/pressroom/object-storage/).

**Безпечніша конфігурація:** 16 GB host або CI-built images. Після цінової зміни `CPX42` (8 shared vCPU/16 GB) значно дорожчий, тому спочатку економічно доцільніше прибрати production builds із сервера: GitHub Actions будує immutable images, push у GHCR, production виконує pull і rolling/restart deployment.

ARM `CAX21` формально дає 4 vCPU/8 GB значно дешевше, але переходити на нього можна лише після повної multi-arch build/test перевірки всіх базових образів і native dependencies. Для першого production переносу x86-64 зменшує ризик.

### Storage, network і backups

- Сервер має локальний NVMe; додаткові Cloud Volumes дають network block storage від 10 GB до 10 TB, а блоки зберігаються на трьох фізичних серверах. Важливе обмеження: server backup/snapshot не включає приєднаний Volume, і Hetzner не створює його backup автоматично ([Volumes overview](https://docs.hetzner.com/cloud/volumes/overview/)). Volume зручний для даних, але не замінює off-host backup.
- EU cloud servers включають щонайменше 20 TB traffic, що робить рахунок значно передбачуванішим для медіа та API ([cloud product page](https://www.hetzner.com/cloud/cost-optimized/)).
- Object Storage сумісний із S3 API, тому поточний adapter Sales AITO можна переключити environment variables без зміни domain logic. Ingress, S3 operations та internal traffic у `eu-central` безкоштовні; excess storage/egress тарифікуються окремо ([Object Storage overview](https://docs.hetzner.com/storage/object-storage/overview/)).
- Load Balancer має public IPv4/IPv6 і підтримує private targets, але на одному VM не усуває single point of failure ([Load Balancer overview](https://docs.hetzner.com/networking/load-balancers/overview/)).

### Ризики

- Shared vCPU може мати менш стабільну CPU performance; Hetzner рекомендує dedicated `CCX` для постійного CPU-intensive production load ([server FAQ](https://docs.hetzner.com/cloud/servers/faq/)).
- Немає first-party managed PostgreSQL/Redis: patching, backup, restore, vacuum, replication і failover — відповідальність команди.
- Один server та його local disk — одна failure domain. Hetzner Backups корисні для VM recovery, але для PostgreSQL потрібен окремий logical/physical backup і тест restore.

## 2. AWS

### Стартова конфігурація

Найпростіший portable старт:

- один EC2 Linux instance у `eu-central-1` Frankfurt, близький до 4 vCPU/8 GB;
- EBS `gp3` для system/data disk;
- charged public IPv4/Elastic IP;
- S3 для object storage і off-host backups;
- без Application Load Balancer, доки EC2 instance один.

AWS не має одного стабільного «all-in» тарифу для цієї схеми. Підсумок залежить від instance family/architecture, Frankfurt region, OS, EBS size/IOPS, public IPv4, snapshots, egress і CloudWatch. Офіційна сторінка EC2 також вказує 100 GB безкоштовного aggregate internet egress на місяць, після чого діють tiered rates; усі public IPv4 адреси тарифікуються ([EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [Elastic IP documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)). Точну суму треба зафіксувати через [AWS Pricing Calculator](https://calculator.aws/) у день закупівлі.

`gp3` включає baseline 3,000 IOPS і 125 MiB/s, а додаткова performance тарифікується окремо; snapshots інкрементальні після першого ([gp3 documentation](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html), [EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/how_snapshots_work.html)).

### Managed шлях

- RDS for PostgreSQL прибирає значну частину patching/backups/failover, але окремо тарифікує DB instance, storage, backup storage і data transfer; Multi-AZ множить базову інфраструктуру ([RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)).
- ElastiCache пропонує on-demand nodes, serverless і savings plans; ціна залежить від engine, node/capacity, backup та inter-AZ traffic ([ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/)).
- S3 окремо тарифікує storage, requests, retrieval і network transfer ([S3 pricing](https://aws.amazon.com/s3/pricing/)).
- Application Load Balancer тарифікується за години та LCU; на старті це зайвий постійний SKU, якщо backend лише один ([ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)).

### Оцінка

AWS має найкращий шлях до multi-AZ та enterprise controls, але рання архітектура `EC2 + RDS + ElastiCache + ALB + S3` суттєво дорожча й складніша, ніж поточний single-host Compose. Якщо AWS обрано зараз, раціонально почати з EC2 + EBS + S3, а RDS додати першим managed кроком, коли вартість простою та ручного відновлення перевищить вартість сервісу.

## 3. Google Cloud

### Стартова конфігурація

- Compute Engine у `europe-central2` Warsaw;
- custom E2 4 vCPU/8 GB або найближчий доступний профіль, підтверджений calculator;
- Balanced Persistent Disk;
- static external IPv4;
- Cloud Storage або залишення S3-compatible external storage;
- без external Application Load Balancer на одному VM.

Google офіційно має три zones у Warsaw і підтримує там E2/N2/N2D та інші machine families ([Compute regions and zones](https://cloud.google.com/compute/docs/regions-zones)). E2 custom дозволяє задати саме 4 vCPU/8 GB, але custom profile має 5% premium відносно відповідних predefined on-demand resources ([custom machine types](https://cloud.google.com/compute/docs/instances/creating-instance-with-custom-machine-type)). Це географічно привабливий варіант для української аудиторії, але фактичну latency треба виміряти з основних ISP України — географічна близькість не гарантує найкращий peering route.

Ціна Compute Engine залежить від machine family, vCPU/RAM, location і discounts. Persistent Disk, snapshots, external IPv4, egress та load balancing є окремими SKU. External IPv4 на standard VM коштує $0.005/год, а зарезервована, але не використана static address — $0.01/год; чинні network tiers та free allowances треба звіряти на сторінці VPC. Офіційна сторінка наводить регіональні ціни й commitment-моделі; точну custom 4/8 конфігурацію треба рахувати через [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator) перед замовленням ([VM pricing](https://cloud.google.com/products/compute/pricing), [disk and snapshot pricing](https://cloud.google.com/compute/disks-image-pricing), [VPC pricing](https://cloud.google.com/vpc/network-pricing)).

### Managed шлях

- Cloud SQL for PostgreSQL тарифікує CPU/RAM, storage і networking; Enterprise та Enterprise Plus мають різні ціни й можливості ([Cloud SQL pricing](https://cloud.google.com/sql/pricing/)).
- Memorystore Basic — standalone Redis; Standard — cross-zone replication та automatic failover. Ціна залежить від provisioned capacity, tier, replicas і region ([Memorystore pricing](https://cloud.google.com/memorystore/docs/redis/pricing), [supported regions](https://cloud.google.com/memorystore/docs/redis/instances)). Обидва доступні у Warsaw.
- Cloud Storage має storage, operations і network SKUs; перенесення з поточного S3 adapter потребує або сумісного шару, або нового вузького provider adapter ([Cloud Storage pricing](https://cloud.google.com/storage/pricing)).
- Load Balancing додає forwarding-rule/data-processing charges; Google прямо рекомендує regional external ALB для single-region workloads як дешевший варіант, але він потрібен лише з кількома backends ([Cloud Load Balancing pricing](https://cloud.google.com/load-balancing/pricing)).

### Оцінка

GCP Warsaw може дати найкращу latency серед hyperscalers і плавний шлях до Cloud SQL/Memorystore. Він дорожчий та операційно складніший за Hetzner single-host, але при переході на managed data services може бути простішим довгостроковим вибором, ніж самостійне будування HA.

## Український ринок, latency і residency

- У всіх трьох варіантах основні дані можна тримати в Європі/ЄС.
- Hetzner має EU locations у Germany/Finland і позиціонує EU cloud як GDPR-compliant; locations і ціни залежать від країни ([Hetzner locations](https://docs.hetzner.com/cloud/general/locations/), [German cloud](https://www.hetzner.com/cloud-made-in-germany/)).
- AWS Frankfurt — повний EU Region із трьома Availability Zones ([AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)). Warsaw у AWS є Local Zone, а не заміна повного Frankfurt region для RDS/ElastiCache архітектури.
- GCP Warsaw — повний region із трьома zones. Google Organization Policy дозволяє обмежувати ресурси EU/Warsaw locations ([resource location constraints](https://cloud.google.com/resource-manager/docs/organization-policy/defining-locations)).
- Data residency не дорівнює повній юридичній відповідності: треба перевірити DPA, subprocessors, backup locations, support access, retention та українські вимоги до персональних даних із юристом.
- Для Meta/Google/provider callbacks стабільність HTTPS і швидкий webhook ACK важливіші за різницю в кілька десятків мілісекунд. Фактичний регіон слід вибрати після latency probes з Києва, заходу та сходу України.

## Рекомендований поетапний план

### Етап 1 — 50–100 активних користувачів

1. Hetzner Germany, один `CPX32` як мінімум або 16 GB host для on-host builds.
2. Залишити дев’ять Compose services, але винести application image build у CI/GHCR.
3. Перемкнути MinIO workloads або принаймні backups на Hetzner Object Storage.
4. Зробити encrypted daily PostgreSQL backup в Object Storage; встановити retention; щомісяця виконувати restore drill на чистому host.
5. Додати container memory/CPU limits, host monitoring, disk alerts і DB connection metrics.
6. Описати provisioning як Terraform/OpenTofu або Ansible; secrets зберігати поза Git.

### Етап 2 — зменшення ризику одного host

1. Винести PostgreSQL першим: managed DB або окремий DB host із перевіреним failover/restore.
2. Централізувати Prisma client/provider і ліміти connections; за потреби PgBouncer.
3. Винести object storage повністю; локальний MinIO прибрати з production.
4. Розділити application і worker; worker scale визначати за queue latency.
5. Додати другий application host і тільки тоді Load Balancer.

### Етап 3 — hyperscaler/HA

Переходити на GCP/AWS, коли з’явиться хоча б одна з умов:

- потрібен формальний multi-zone SLA;
- команда витрачає забагато часу на DB/Redis/OS operations;
- є прогнозоване навантаження, що виправдовує commitments;
- enterprise клієнти вимагають cloud-specific controls/audit;
- downtime одного host має більшу очікувану вартість, ніж managed stack.

## Як зробити перенесення простим

1. Не прив’язувати domain logic до AWS/GCP SDK; залишити вузькі adapters для DB/Redis/object storage.
2. Зберігати Docker images в registry й деплоїти immutable tag/digest.
3. Описати compute/network/firewall/storage через IaC.
4. Автоматизувати backup, restore і migration smoke test.
5. Не переносити Docker volumes «як є» між cloud providers: PostgreSQL — через validated backup/restore або replication, S3 data — через object copy + checksum.
6. Тримати application stateless; session/queue/data мають бути в зовнішніх shared services до horizontal scaling.
7. Вимірювати й обмежувати DB connections до запуску кількох API/worker replicas.

## Рішення

**Рекомендація зараз:** Hetzner Cloud Germany із portable Docker Compose, off-host backups/object storage та CI-built images. Це найдешевший контрольований старт без перепроєктування застосунку.

**Рекомендований hyperscaler на наступний етап:** Google Cloud Warsaw, якщо головні критерії — українська latency та managed PostgreSQL/Redis. AWS Frankfurt обирати, якщо пріоритет — найширша enterprise-екосистема, multi-account governance і AWS-specific integrations.

Перед оплатою треба створити три однакові calculator estimates з однаковими припущеннями: 730 годин, Linux, 4 vCPU/8 GB, 100–160 GB SSD, одна IPv4, 100/500 GB egress, 7–14 daily backups, object storage 100/500 GB, окремо single-host і managed-DB варіанти. Це дасть чесне порівняння без змішування різних рівнів надійності.

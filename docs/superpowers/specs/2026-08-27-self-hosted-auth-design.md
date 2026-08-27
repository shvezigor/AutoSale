# AutoSale Self-Hosted Authentication Design

## Мета

Додати повністю self-hosted авторизацію для платформи AutoSale. Власник бізнесу самостійно реєструється, створює організацію та запрошує менеджерів. Platform admin керує платформою й бачить технічний стан, але не має доступу до клієнтських діалогів, замовлень, контактів, адрес або вкладень.

## Ролі та межі доступу

### PLATFORM_ADMIN

- Бачить організації, email власника, кількість користувачів, агреговану кількість замовлень і помилок, health та стан інтеграцій.
- Може блокувати користувачів або організації та відкликати їхні сесії.
- Не може викликати tenant business endpoints для conversations, messages, attachments, orders, AI extraction або customer data.
- Не має механізму impersonation.

### TENANT_OWNER

- Створюється через публічну реєстрацію та підтвердження email.
- Керує командою своєї організації, інтеграціями, approval policy та всіма business data власного tenant.
- Запрошує менеджерів через email і може блокувати їх або відкликати сесії.

### TENANT_MANAGER

- Переглядає діалоги й обробляє замовлення тільки своєї організації.
- Не керує користувачами, memberships або integration secrets.

Користувач першої версії належить до однієї tenant-організації. Майбутня підтримка кількох memberships не повинна вимагати зміни основної моделі даних.

## Технологічне рішення

- Авторизація реалізується в NestJS і PostgreSQL без зовнішнього identity provider.
- Паролі хешуються Argon2id з параметрами, які зберігаються у hash string і можуть бути підсилені під час наступного входу.
- Браузер отримує випадковий opaque session token у cookie `HttpOnly`, `Secure` у production, `SameSite=Lax`, `Path=/`.
- PostgreSQL зберігає тільки SHA-256 hash session token.
- Абсолютний термін сесії — 30 днів; остання активність оновлюється з обмеженою частотою, щоб не писати в БД на кожен request.
- Зміна пароля, блокування користувача або membership відкликає відповідні активні сесії.

## Модель даних

### User

`id`, normalized unique `email`, `name`, `passwordHash`, `emailVerifiedAt`, `platformRole`, `status`, `createdAt`, `updatedAt`.

### TenantMembership

`id`, `userId`, `tenantId`, `role`, `status`, `createdAt`, `updatedAt`. Пара `(userId, tenantId)` унікальна.

### Session

`id`, `userId`, optional active `tenantId`, `tokenHash`, `expiresAt`, `lastSeenAt`, redacted `ipPrefix`, bounded `userAgent`, `revokedAt`, `createdAt`.

### Одноразові токени

`EmailVerificationToken`, `PasswordResetToken` і `TenantInvitation` зберігають тільки token hash, expiry, usedAt і зв’язок із користувачем або tenant. Invitation додатково містить normalized email, роль і автора запрошення. Термін invitation — 48 годин.

### SecurityAuditLog

Зберігає actor, tenant, action, result, безпечні metadata й timestamp. Паролі, session tokens, verification/reset/invitation tokens і customer data заборонені.

## Публічні потоки

### Реєстрація

1. Користувач вводить ім’я, email, пароль і назву організації на `/register`.
2. API нормалізує email, застосовує rate limit, створює неактивного user, tenant, OWNER membership і verification token в одній транзакції.
3. Email delivery отримує одноразове verification посилання.
4. `/verify-email` одноразово активує user та membership.
5. Після підтвердження користувач входить через `/login`.

Production не завершує register flow без налаштованого email delivery. Development може повернути verification URL в окремому dev-only полі, яке фізично недоступне при `NODE_ENV=production`.

### Login і logout

Login повертає однакову помилку для невідомого email, неправильного пароля, непідтвердженого або заблокованого user. Після успіху створюється session і cookie. Logout відкликає поточну session та очищає cookie.

### Password reset

Запит завжди повертає нейтральну відповідь. Якщо активний user існує, створюється одноразовий token. Успішний reset змінює password hash і відкликає всі sessions користувача.

### Запрошення менеджера

OWNER створює invitation на `/team`. Email містить одноразове посилання. Новий користувач задає ім’я та пароль; існуючий підтверджує приєднання після входу. Прийняття invitation створює або активує MANAGER membership в одній транзакції.

До підключення email provider development UI показує OWNER посилання для копіювання. Production таке посилання ніколи не повертає.

## Tenant isolation

- Глобальний auth guard отримує session із cookie, перевіряє status user/session/membership і формує server-side principal.
- `tenantId` береться тільки з principal. Query, body або довільний header не можуть змінити tenant scope.
- Repository/service methods для business data вимагають tenant ID як явний аргумент і фільтрують ним кожен lookup, включно з lookup за UUID.
- PLATFORM_ADMIN endpoints фізично відокремлені від tenant controllers і повертають лише дозволені агрегати.
- Cross-tenant resource lookup повертає `404`, щоб не підтверджувати існування чужого UUID. Role violation усередині власного tenant повертає `403`.
- Поточний `DEFAULT_TENANT_ID` використовується тільки для контрольованої міграції локальних даних і після переходу не визначає request scope.

## CSRF, abuse та cookies

- Mutating browser requests використовують synchronizer CSRF token, прив’язаний до session.
- Login, register, reset і invitation acceptance мають Redis-backed rate limits за route, IP prefix та normalized email hash.
- Password policy: мінімум 12 символів; верхня межа 128; перевірка поширених паролів локальним denylist без передачі пароля назовні.
- Після серії невдалих входів застосовується тимчасове exponential throttling, а не постійний lockout, який дозволяє блокувати чужі акаунти.
- Cookie `Secure` обов’язковий у production; Caddy завершує TLS.

## UI

- Публічні сторінки: `/register`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`, `/invite/[token]`.
- `/team`: список memberships, invitation status, invite, revoke/block; тільки OWNER.
- `/admin`: список організацій і користувачів, агреговані usage/error/health indicators; тільки PLATFORM_ADMIN.
- Існуючі `/conversations`, `/orders`, `/settings` вимагають tenant session.
- Навігація показує тільки дозволені розділи. Серверна авторизація залишається джерелом істини незалежно від прихованих UI controls.

## Email delivery boundary

Вводиться інтерфейс `EmailDelivery` з операціями verification, password reset та invitation. Перша реалізація має production adapter через конфігурований SMTP і development adapter, який повертає локальний preview URL без логування token. Реальні SMTP credentials підключаються пізніше як Docker secret/environment.

## Аудит і приватність

- Security events логуються окремо від order audit.
- Platform admin агрегати обчислюються без читання/повернення customer payloads.
- Логи проходять наявну redaction layer.
- Session IP зберігається лише як скорочений prefix; user-agent має жорстку межу довжини.
- Видалення tenant у цій фазі не реалізується; блокування є reversible.

## Міграція

1. Додати auth tables без зміни наявних business records.
2. Створити bootstrap PLATFORM_ADMIN через одноразову CLI-команду з паролем зі stdin.
3. Створити OWNER user/membership для поточного локального tenant через окрему migration/bootstrap команду.
4. Увімкнути guards у compatibility mode для тестів.
5. Оновити UI й E2E для login.
6. Прибрати request-time залежність від `DEFAULT_TENANT_ID` після перевірки tenant-scoped repositories.

## Обробка помилок

- Auth responses не розкривають існування email.
- Expired/used tokens повертають одну безпечну помилку та не змінюють стан.
- Транзакція register/invite acceptance повністю відкочується при конфлікті.
- Недоступний Redis не дозволяє обійти rate limit: sensitive endpoints fail closed із `503`.
- Недоступний email provider не активує production registration/invitation flow і повертає контрольовану помилку без credentials.

## Тестування та критерії приймання

- Unit: password hashing/rehash, token hashing/expiry/use, session lifecycle, CSRF, authorization policy.
- Integration: register → verify → login → logout; reset; invitation; user/membership blocking; session revocation.
- Isolation matrix: OWNER/MANAGER/PLATFORM_ADMIN/anonymous проти кожного controller; cross-tenant UUID перевірки для conversations, media, orders, products, settings і exports.
- Playwright: self-registration, email preview у development, login, invite manager, manager restrictions, admin aggregate dashboard.
- Security: cookies мають потрібні flags; secrets/tokens відсутні в logs; enumeration responses однакові; rate limit працює.
- Migration: наявні conversation, order та attachment доступні створеному OWNER і недоступні іншому tenant.

Функція вважається готовою, коли всі business endpoints закриті session guard, tenant isolation доведена негативними тестами, OWNER може зареєструватися та запросити MANAGER, а PLATFORM_ADMIN бачить тільки дозволені агрегати.


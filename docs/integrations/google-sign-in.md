# Вхід у AutoSale через Google

Google Sign-In відповідає лише за ідентифікацію користувача. Він не надає AutoSale доступу до Google Drive або Google Sheets і не створює запис у `google_connections`.

## Налаштування Google Cloud

Для поточного середовища використовується Google Cloud project `sage-ripple-261508` та OAuth 2.0 Web application.

У Google Cloud Console налаштуйте:

- Authorized JavaScript origin: `https://sales-aito.com`
- Authorized redirect URI: `https://sales-aito.com/api/auth/google/callback`
- Scopes: `openid`, `email`, `profile`
- Homepage: `https://sales-aito.com`
- Privacy policy: `https://sales-aito.com/privacy`
- Terms: `https://sales-aito.com/terms`

Client secret не можна додавати у Git, браузерні змінні або Docker image.

## Змінні середовища

```dotenv
GOOGLE_OAUTH_CLIENT_ID=<server-only-client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<server-only-client-secret>
GOOGLE_SIGN_IN_REDIRECT_URI=https://sales-aito.com/api/auth/google/callback
GOOGLE_SIGN_IN_ENABLED=true
APP_PUBLIC_URL=https://sales-aito.com
```

Спочатку збережіть production redirect URI у Google Cloud. Лише після цього вмикайте `GOOGLE_SIGN_IN_ENABLED=true` та перебудовуйте API.

## Перевірка після розгортання

1. На `/login` натисніть **Продовжити з Google**.
2. Для існуючого активного користувача з таким самим підтвердженим email перевірте автоматичну прив’язку без створення дубліката.
3. Для нового Google-акаунта перевірте перехід на `/onboarding/google`.
4. Введіть назву бізнесу та переконайтеся, що створено рівно один workspace з роллю `OWNER`.
5. Вийдіть і повторно увійдіть через Google — онбординг більше не повинен з’являтися.
6. Перевірте, що підключення Google Sheets у налаштуваннях не змінилося.
7. Перевірте скасування входу, повторний callback і прострочений онбординг — вони мають завершуватися нейтральною помилкою без витоку даних.

## Відкат

Встановіть `GOOGLE_SIGN_IN_ENABLED=false` і перебудуйте API. Це вимикає лише початок/завершення Google-входу. Парольний вхід, користувачі, сесії, прив’язані Google identities та Google Sheets credentials не видаляються і не змінюються.

## Дані й безпека

- Authorization code та Google provider tokens не зберігаються.
- OAuth `state` та onboarding grant зберігаються лише у вигляді SHA-256 hash.
- В audit metadata email і Google subject записуються лише як незворотні hashes.
- Google-вхід використовує окрему HttpOnly onboarding cookie та стандартну session cookie AutoSale.

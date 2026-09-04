# AutoSale

Self-hosted сервіс для обробки замовлень із чатів, AI-розпізнавання товарів, менеджерського погодження та синхронізації з Google Sheets.

## Локальний запуск

1. Скопіюйте `.env.example` у `.env` та заповніть секрети.
2. Запустіть Docker Desktop.
3. Виконайте:

```powershell
docker compose up -d --build
```

Локально сайт відкривається на `http://localhost`. Production-домен: `https://sales-aito.com`.

## Інтеграції

- [Google Sign-In](docs/integrations/google-sign-in.md) — вхід користувачів і створення workspace.
- [Google Sheets](docs/integrations/google-sheets-access.md) — окреме підключення таблиць клієнта.

Google Sign-In і Google Sheets OAuth мають різні призначення, scopes, токени та життєві цикли.

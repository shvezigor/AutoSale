# Підключення Google Sheets

AutoSale використовує service account. Приватний ключ не зберігається в PostgreSQL, браузері, Git або Docker image.

## Підготовка Google

1. У Google Cloud створіть service account і увімкніть Google Sheets API.
2. Створіть JSON key для service account.
3. Поширте лише цільову Google таблицю на `client_email` із JSON-файлу з правами редактора.
4. У першому рядку вкладки створіть колонки, показані в AutoSale.

## Локальний Docker

Збережіть ключ як `secrets/google-service-account.json`. Каталог `secrets/` ігнорується Git.

Запуск із read-only mount:

```powershell
docker compose --env-file .env.example --env-file .env -f compose.yaml -f compose.google-sheets.yaml up -d --build
```

Після запуску відкрийте `http://localhost/settings`, введіть ID таблиці та назву вкладки, збережіть і натисніть «Перевірити доступ».

## Перенесення на сервер

На новому сервері потрібно перенести репозиторій і окремо безпечним каналом доставити JSON key у `secrets/google-service-account.json`. Сам ключ не повинен потрапляти в backup вихідного коду або CI artifacts.

Google рекомендує клієнтську auth-бібліотеку для server-to-server OAuth, а читання заголовка виконується через `spreadsheets.values.get` для діапазону першого рядка.

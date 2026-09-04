# Підключення Google Sheets

> Це окрема інтеграція з доступом до таблиць. Кнопка **Продовжити з Google** використовується тільки для входу в AutoSale і не дає доступу до Drive або Sheets.

Основний клієнтський сценарій використовує tenant OAuth: власник робочого простору входить у Google, вибирає конкретний файл через Google Picker і підтверджує доступ. Refresh token зберігається зашифрованим на сервері та ніколи не передається у браузер. Service account залишається лише локальним/перехідним варіантом.

## Основний OAuth-сценарій

1. Власник відкриває налаштування AutoSale та натискає підключення Google.
2. Google окремо запитує дозволи Drive/Sheets — незалежно від Google Sign-In.
3. Власник вибирає конкретну таблицю та вкладку.
4. AutoSale перевіряє доступ і зберігає лише конфігурацію джерела/призначення та зашифровані credentials.
5. Відкликання Sheets-доступу не блокує вхід через Google; вимкнення Google Sign-In не розриває Sheets-з’єднання.

## Локальний service account

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

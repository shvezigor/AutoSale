# Спостережуваність AutoSale

## Питання чергового інженера

1. На якому кроці зупинилося конкретне замовлення від Meta webhook до Google Sheets?
2. Яка частка normalization та Sheets export завершується помилкою?
3. Чи росте черга незавершених експортів?
4. Чи зросла тривалість HTTP-запитів або зовнішніх операцій?

## Кореляція та логи

API приймає безпечний `x-request-id` або генерує UUID і повертає його у відповіді. Для фонового Instagram-процесу `correlationId` дорівнює ID збереженої webhook-події. Цей самий ID відновлюється через trigger message під час експорту замовлення в Google Sheets.

Логи записуються як один JSON-об’єкт на рядок. Поля з назвами `token`, `secret`, `password`, `authorization`, `cookie`, `phone`, `email`, `address`, `payload` і `body` автоматично замінюються на `[REDACTED]`. Не додавайте до логів повні DTO або request body.

## Метрики

- API у внутрішній Docker-мережі: `GET http://api:3001/metrics`
- Worker у внутрішній Docker-мережі: `GET http://worker:3002/metrics`
- `autosale_http_requests_total` — rate/error за method, route template і status class.
- `autosale_http_request_duration_seconds` — histogram тривалості HTTP.
- `autosale_operations_total` — результат normalization та Sheets export.
- `autosale_operation_duration_seconds` — histogram фонового процесу.
- `autosale_queue_backlog{queue="google_sheets"}` — поточна кількість знайдених pending export.

У labels заборонені order ID, request ID, URL, повідомлення помилки та інші необмежені значення.

## Початкові сигнали

- **Page:** частка `sheets_export/failure` понад 5% протягом 10 хвилин, якщо було щонайменше 20 спроб. Перевірити Google credentials, quota та останні `sheets_export_failed` за `correlationId`.
- **Page:** найстаріший pending export очікує понад 10 хвилин. Перевірити worker health, mounted secret і backlog.
- **Ticket:** p95 HTTP latency понад 2 секунди протягом 30 хвилин. Перевірити маршрут, PostgreSQL і зовнішні залежності.

Порогові значення треба скоригувати після накопичення реального трафіку; не додавайте pager без підключеного каналу оповіщення та перевіреного runbook.

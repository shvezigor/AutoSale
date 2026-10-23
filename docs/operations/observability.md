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
- Web server records `web_upstream_slow` when an internal API call takes at least 1 second and `web_upstream_failed` for API 5xx or network failure. These JSON log events contain only a bounded route group (`orders`, `auth`, etc., otherwise `other`), status class, elapsed milliseconds and a generated request ID. The same ID is forwarded as `x-request-id` to the API and appears in its existing request-completion log. Never log the full URL, query string, cookies, response body or exception message. These events measure the **web → API hop**, not the full browser navigation, Next rendering or Cloudflare tunnel; compare them with API histograms before attributing a slow page to the database.
- Caddy writes scoped access timing for exact `/dashboard` and `/orders` paths to `/data/workspace-navigation-timing.log` inside the proxy container. The JSON entries contain only a fixed `route` label (`dashboard` or `orders`), response status, duration in milliseconds, response size and Caddy's non-request log metadata. The request object, response headers and even Caddy's currently empty `user_id` field are removed before encoding; all other paths are skipped. The file rolls at 10 MiB, keeps at most three rotated files and expires rotated files after seven days. Read it locally with `docker exec autosale-proxy-1 tail -n 50 /data/workspace-navigation-timing.log`; do not copy raw logs into tickets. This measures time at Caddy through the upstream response, **not** Cloudflare, browser rendering or the complete click-to-visible transition. Run `infra/scripts/verify-caddy-route-timing.ps1` before changing the Caddy logging contract; its isolated-container probe checks route scope and private-data exclusion.
- The authenticated workspace has a **tab-only, opt-in** Dashboard/Orders client probe. Open `/dashboard?navTiming=1` in the test browser tab to enable it there; `/dashboard?navTiming=0` disables it. The switch persists only in that tab's `sessionStorage`, not in a user profile or on the server. A normal primary-sidebar click to Dashboard or Orders starts the timer; after the destination's server content mounts and a browser paint has passed, the console emits `workspace_navigation_ready` with only the fixed `dashboard`/`orders` label and rounded `durationMs`. It records no URL, query, customer/order identifier, content or account details, and sends no telemetry request. Other destinations, same-page clicks and modified new-tab clicks are not samples. Read only the test tab's filtered console entries and compare their capture timestamps with the nearest matching Caddy route response. Browser throttling, a hidden tab, prefetched responses and automation scheduling can affect comparison. This probe measures the app's click-to-painted-content boundary, **not** the entire user-observed delay or a network waterfall. Disable it after a diagnostic session; never copy unrelated console entries or production page content into an issue.
- `autosale_http_requests_total` — rate/error за method, route template і status class.
- `autosale_http_request_duration_seconds` — histogram тривалості HTTP.
- `autosale_operations_total` — результат normalization та Sheets export.
- `autosale_operation_duration_seconds` — histogram фонового процесу.
- `autosale_queue_backlog{queue="google_sheets"}` — поточна кількість знайдених pending export.

Для Google OAuth відстежуйте лише tenant-safe події: connect success/failure, refresh failure за стабільним кодом, reconnect-required, cleanup retry/terminal і тривалість Sheets/Drive операції. Заборонено логувати authorization code, access/refresh token, Google email, назву/ID таблиці, назву вкладки або її рядки.

У labels заборонені order ID, request ID, URL, повідомлення помилки та інші необмежені значення.

## Початкові сигнали

- **Page:** частка `sheets_export/failure` понад 5% протягом 10 хвилин, якщо було щонайменше 20 спроб. Перевірити стан tenant OAuth, quota та останні `sheets_export_failed` за `correlationId`.
- **Ticket:** зростає кількість `REAUTHORIZATION_REQUIRED` або terminal cleanup. Власнику показати reconnect; не відновлювати grant вручну й не копіювати токени в support channel.
- **Page:** найстаріший pending export очікує понад 10 хвилин. Перевірити worker health, mounted secret і backlog.
- **Ticket:** p95 HTTP latency понад 2 секунди протягом 30 хвилин. Перевірити маршрут, PostgreSQL і зовнішні залежності.

Порогові значення треба скоригувати після накопичення реального трафіку; не додавайте pager без підключеного каналу оповіщення та перевіреного runbook.

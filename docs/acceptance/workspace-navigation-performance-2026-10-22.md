# Workspace navigation performance acceptance — 22 October 2026

Environment: production `https://sales-aito.com`, authenticated Ukrainian desktop workspace in Chrome. Changes: `63240e9` (order-detail list links) and `d413a21` (intent-based sidebar prefetch), both deployed in the web container. API, worker and database application code was not changed.

| Scenario | Before | After |
|---|---:|---:|
| Successful `/api/auth/session` requests caused by one Orders reload | 29 | 2 |
| Intermediate result after suppressing only order-row prefetch | — | 15 |
| Five warmed Orders reloads, browser click-to-visible table | 0.69–1.63 s | 0.59–0.80 s |

The first reload after the final web-container recreation took 7.7 s; the next five took 0.70, 0.75, 0.61, 0.59 and 0.80 s. This single slow first load must not be presented as a sustained improvement or regression. Dashboard → Orders took 0.54 s, Orders → Dashboard 0.64 s, keyboard activation of Catalogue 0.57 s. The first order detail opened, the user returned to Orders, and the browser reported no console errors after deployment. External `/health/live` returned 200; web, API, worker, PostgreSQL and MinIO were healthy. No API 5xx counter was observed in the short period after the Docker restart.

These observations prove fewer redundant authenticated requests and a working navigation path, not that every intermittent slow-load incident is fixed. Before the change, two Orders API 5xx responses were observed in one production burst; their exception cause was not logged and remains unidentified. If the skeleton persists again, capture the request timestamp, route and safe error category before changing query or infrastructure behavior. A full multi-service Docker build stalled the local Docker engine during deployment; the engine was restarted, and a sequential web-only build/deploy completed successfully. Do not infer from this acceptance that the current Windows-host deployment can safely run concurrent full-service builds.

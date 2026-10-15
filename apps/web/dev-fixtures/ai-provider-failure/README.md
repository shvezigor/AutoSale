# Isolated AI provider-failure browser fixture

Run from the repository root:

```sh
pnpm exec vite --config apps/web/dev-fixtures/ai-provider-failure/vite.config.mjs
```

Open `http://127.0.0.1:4177/` in a real browser. This test-only Vite page renders the production `SocialReplyComposer` and stylesheet with a fictional, persisted `PROVIDER_UNAVAILABLE` conversation. Its local API keeps the failed draft across reloads. No production database, provider, account or message is contacted; the local send endpoint is disabled.

Check that the localized outage message is shown, manual reply remains editable, empty submission focuses the field error, and the failed state survives reload. `http://127.0.0.1:4177/__fixture/stats` reports `explicitRetryCount: 0` until **Спробувати ще раз** is clicked; one click must produce exactly one local request and an inline retry error. This fixture validates browser presentation and interaction only. It does not close the controlled live-provider outage acceptance gate.

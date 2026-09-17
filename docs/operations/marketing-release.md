# Sales AITO marketing release

## Required production configuration

```dotenv
APP_PUBLIC_URL=https://sales-aito.com
DEMO_LEAD_EMAIL=sales@example.com
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=Sales AITO <no-reply@sales-aito.com>
CLOUDFLARE_TUNNEL_TOKEN=...
```

`DEMO_LEAD_EMAIL` is the internal recipient of demo notifications. A demo lead is committed to PostgreSQL before email delivery. A delivery failure leaves the lead with `FAILED` notification status for operator recovery.

## Deployment order

1. Back up PostgreSQL.
2. Build all images and validate `docker compose config`.
3. Run the migration containing `20260917150000_demo_leads`.
4. Deploy API, worker, web, and proxy services.
5. Verify the Cloudflare Tunnel route points `sales-aito.com` to the proxy service.
6. Run the public endpoint checks from `docs/operations/search-indexing.md`.
7. Submit one test demo lead with an approved internal test contact and confirm both the database record and notification email.
8. Complete Search Console and Bing verification.

## Rollback

Roll back application containers first. The demo lead table is additive and can remain in place during an application rollback. Do not drop it while leads may contain unresolved business contacts.

## Deployment record

### 2026-09-17

- Deployed application commit `4204556` with container asset fix `8cd536d`.
- Created the pre-deployment PostgreSQL backup under `backups/20260917T185528Z` with its SHA-256 recorded in the local manifest.
- Applied migration `20260917150000_demo_leads` successfully.
- Confirmed healthy API, worker, and web containers.
- Confirmed HTTPS 200 responses for the localized home pages, pricing, demo, login, health endpoint, robots, sitemap, original hero asset, and optimized hero asset.
- Confirmed canonical URL, reciprocal English alternate, JSON-LD, public indexing directive, and private login noindex directive in production HTML.
- SMTP delivery and search-console submission remain pending external configuration.

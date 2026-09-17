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

# Sales AITO / AutoSale

Sales AITO is an omnichannel sales automation platform for Ukrainian online businesses. It turns customer conversations into structured orders, matches products against a catalogue, supports manager review, creates delivery workflows, notifies suppliers, and exports operational data. The public product brand and website use **Sales AITO**; the repository, package names, containers, and some internal documentation still use the historical technical name **AutoSale**.

- Public website: [https://sales-aito.com](https://sales-aito.com)
- Application login: [https://sales-aito.com/login](https://sales-aito.com/login)
- Product documentation index: [`docs/features/README.md`](docs/features/README.md)

## Product direction and current scope

The target is end-to-end AI-assisted sales automation: receive a message, clarify missing information, recognize products, create an order, prepare a shipping document, export data, and notify a supplier when stock is missing.

Currently implemented areas include:

- Ukrainian/English marketing pages with SEO metadata, sitemap, robots rules, pricing and demo-lead capture;
- registration, sessions, Google Sign-In, tenant roles, teams and user profiles;
- Meta Instagram OAuth, signed webhook ingestion, conversations, media and durable manual replies;
- AI order recognition, manager review, approval and audit history;
- product catalogue management, spreadsheet import, AI-assisted column mapping and scheduled synchronization;
- per-tenant Google Sheets OAuth and exactly-once order export;
- procurement state, stock reservation, Telegram supplier dispatch and personal notifications;
- delivery integrations for Nova Poshta, Meest and Ukrposhta;
- operational dashboard, notifications, observability, backup and restore.

Facebook, Threads, TikTok, Viber, email services and additional business integrations are planned extensions of the provider-neutral conversation and order model. They must not be presented as implemented until an adapter and acceptance evidence exist. Pricing is published as a hypothesis, while automated billing and subscription enforcement remain planned. See the [feature map](docs/features/README.md) for evidence-based status.

## System flow

```text
Customer channel
      │
      ▼
signed webhook / provider adapter
      │
      ▼
PostgreSQL event + BullMQ job ──► media copied to S3/MinIO
      │
      ▼
normalized conversation ──► AI extraction ──► catalogue matching
      │                                      │
      ▼                                      ▼
manager inbox/review ──► approved order ──► procurement + delivery
                                                │
                                                ├──► Google Sheets
                                                └──► Telegram supplier/user alerts
```

PostgreSQL is the source of truth. Redis/BullMQ handles durable asynchronous work. MinIO or another S3-compatible store owns copied media. External systems are projections or providers, not the authoritative order database. AI and provider responses are treated as untrusted until validated against schemas, tenant scope, catalogue and business invariants.

## Repository layout

| Path | Responsibility |
|---|---|
| `apps/web` | Next.js marketing site and authenticated workspace |
| `apps/api` | NestJS HTTP API, auth, integrations and domain services |
| `apps/worker` | BullMQ processors, AI recognition, synchronization and reconciliation |
| `packages/contracts` | Shared Zod contracts and public domain types |
| `packages/database` | Prisma schema, migrations and database helpers |
| `packages/integrations` | Provider clients and adapters |
| `packages/config` | Validated API/worker environment configuration |
| `packages/observability` | Structured logging, metrics and redaction helpers |
| `tests/e2e` | Playwright acceptance scenarios |
| `docs` | Feature specs, plans, runbooks, research and acceptance evidence |
| `.codex/skills` | Repository-specific workflows used by development agents |
| `infra/scripts` | Deployment, backup and restore automation |

## Local prerequisites

- Git
- Docker Desktop or Docker Engine with Compose v2
- Node.js compatible with the lockfile tooling
- pnpm `10.15.0` via Corepack or a local installation
- at least 4 GB RAM for the complete Docker stack

Provider-dependent flows additionally require their own test applications or credentials. Do not use production customer accounts or data for local acceptance.

## Quick start with Docker

1. Clone the repository and switch to `master`.
2. Copy `.env.example` to `.env`.
3. Replace development placeholders with local secrets. Never commit `.env`.
4. Start Docker Desktop.
5. Build and start the stack:

```powershell
docker compose up -d --build
docker compose ps
```

The proxy serves the application at `http://localhost`. The stack contains web, API, worker, migration, PostgreSQL, Redis, MinIO and Caddy services. Health endpoints:

- API: `http://localhost/health/live`
- production: `https://sales-aito.com/health/live`

To stop the application without deleting volumes:

```powershell
docker compose down
```

## Workspace commands

Install dependencies when running packages directly outside Docker:

```powershell
corepack enable
pnpm install --frozen-lockfile
```

| Command | Purpose |
|---|---|
| `pnpm typecheck` | Type-check all workspace packages |
| `pnpm test` | Run all unit and integration test suites |
| `pnpm build` | Build all packages and applications |
| `pnpm test:e2e` | Run Playwright against `E2E_BASE_URL` |
| `pnpm --filter @autosale/database generate` | Regenerate Prisma client after schema changes |
| `docker compose up -d --build` | Build and start the complete local stack |
| `docker compose logs -f api worker web` | Follow primary service logs |
| `python scripts/generate-manual-test-workbook.py` | Rebuild the fictional manual catalogue/order workbook fixture |

Some database tests require a running PostgreSQL instance and explicit test environment values. Live provider acceptance is opt-in and must use controlled test tenants.

## Configuration and integrations

Use `.env.example` as the authoritative list of environment variables. Store real values only in local or deployment secret storage.

Integration runbooks:

- [Meta / Instagram access](docs/integrations/meta-access.md)
- [Meta app review](docs/integrations/meta-app-review.md)
- [Meta Instagram OAuth and webhook setup](docs/integrations/meta-instagram-oauth.md)
- [Google OAuth and Picker setup](docs/integrations/google-oauth-setup.md)
- [Google Sheets access model](docs/integrations/google-sheets-access.md)
- [Google Sign-In](docs/integrations/google-sign-in.md)

Google Sign-In and Google Sheets OAuth are separate integrations with different scopes, tokens and lifecycles. `APP_PUBLIC_URL` must match the exact public HTTPS origin used by provider callbacks.

## Development workflow and feature knowledge

Before changing functionality:

1. Read the repository instructions in [`AGENTS.md`](AGENTS.md).
2. Use [`.codex/skills/feature-knowledge/SKILL.md`](.codex/skills/feature-knowledge/SKILL.md).
3. Locate the capability in [`docs/features/README.md`](docs/features/README.md).
4. Read only its linked canonical spec, runbook, source entry points and tests.
5. Search for existing services, contracts, adapters, queues and models before adding new ones.

This progressive-disclosure approach keeps work out of a single chat context and prevents parallel implementations of the same feature. When behavior changes, update the canonical feature document and feature index in the same commit.

Git lifecycle:

```text
update master → create codex/<feature> → implement and verify
→ commit → merge into master → push master → delete merged branch
```

Do not delete a branch or worktree until its unique commits and untracked files have been audited.

## Testing and acceptance

For ordinary changes, run the narrowest relevant tests during development and the full typecheck before completion. Run broader suites in proportion to risk.

Primary acceptance records:

- [MVP and provider acceptance](docs/acceptance/mvp-checklist.md)
- [Marketing site acceptance](docs/acceptance/marketing-site-checklist.md)

Manual test data belongs under `tests/fixtures/` and must be clearly fictional. Runtime state, real database dumps, OAuth material and production evidence containing personal data must remain outside Git.

## Deployment and operations

Production deployment uses the verified `master` commit or an immutable release tag. The migration container runs `prisma migrate deploy` before API and worker startup.

- [Deployment](docs/operations/deployment.md)
- [Authentication administration](docs/operations/authentication.md)
- [Backup and restore](docs/operations/backup-restore.md)
- [Observability](docs/operations/observability.md)
- [Marketing release](docs/operations/marketing-release.md)
- [Search indexing](docs/operations/search-indexing.md)

Database backups are deliberately ignored by Git. Store and rotate them according to the backup runbook; Git is not backup storage.

## Security rules

- Never commit `.env`, provider credentials, OAuth tokens, private keys, database dumps or production personal data.
- Keep webhook signature verification and tenant authorization at external boundaries.
- Encrypt refresh tokens and integration credentials at rest.
- Make external side effects idempotent and reconcile unknown outcomes before retrying creation.
- Redact tokens, phone numbers, addresses and raw provider payloads from logs and metric labels.
- Treat fixture data as public repository content and use fictional identities only.

## Documentation map

- [Feature map](docs/features/README.md) — first stop for development work.
- `docs/superpowers/specs/` — canonical behavior and design.
- `docs/superpowers/plans/` — historical implementation plans.
- `docs/integrations/` — provider setup.
- `docs/operations/` — deployment and recovery.
- `docs/acceptance/` — verified evidence and live gaps.
- `docs/research/` — external research that may need freshness checks.
- `CAPABILITY-MAP-*.md` and root `SPEC-*.md` — scoped marketing/Telegram implementation artifacts; consult when changing those areas.

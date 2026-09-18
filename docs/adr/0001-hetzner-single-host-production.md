# ADR 0001: Hetzner single-host production baseline

- **Status:** Accepted for the initial production stage; provisioning pending
- **Date:** 2026-09-18
- **Decision owner:** Sales AITO

## Context

Sales AITO currently runs nine Docker Compose services: Cloudflare Tunnel, Caddy, web, API, worker, one-shot migrations, PostgreSQL, Redis, and MinIO. The initial target is approximately 50–100 active users in Ukraine. Cost, simple operations, and provider portability matter more at this stage than multi-zone availability.

The current release script builds application images on the deployment host. This increases peak RAM usage compared with a future immutable-image deployment from a registry.

## Decision

Use one Hetzner Cloud x86 server in Germany as the initial remote production host:

- target name: `sales-aito-prod-01`;
- separate Hetzner project named `Sales AITO` rather than mixing production into an unrelated project;
- location: Falkenstein or Nuremberg in `eu-central`;
- operating system: Ubuntu 24.04 LTS;
- minimum size: CPX32, 4 shared vCPU, 8 GB RAM, 160 GB SSD;
- safer size while images are built on-host: CPX42, 8 shared vCPU, 16 GB RAM, 320 GB SSD;
- public IPv4 and IPv6 initially; inbound access restricted by Hetzner Cloud Firewall;
- Hetzner automatic server backups enabled, plus independent application-consistent off-host backups;
- no attached Volume at launch unless measured storage demand requires it;
- Cloudflare Tunnel remains the public ingress; PostgreSQL, Redis, and MinIO are not publicly reachable;
- the existing Docker Compose deployment remains the portability boundary.

CPX32 is the cost-minimizing start. If production builds cause memory pressure, either rescale to CPX42 or finish registry-based immutable deployments before adding traffic. Do not accept repeated OOM restarts as normal operation.

## Consequences

Benefits:

- low fixed cost and straightforward vertical scaling;
- no application rewrite or managed-service migration is required;
- the same backup/restore process can move the system to another provider;
- CPU/RAM can be increased through Hetzner Rescale without rebuilding the application environment manually.

Trade-offs:

- one VM is a single failure domain;
- application builds, application runtime, database, queue, and object storage contend for the same resources;
- server rescale requires a planned restart window;
- increasing the primary disk is effectively one-way; attached Volumes can grow but cannot shrink and are not included in server backups;
- Docker group access is effectively root access and must be limited to the deploy operator.

## Scale-out triggers

Revisit this ADR when any of the following becomes true:

- sustained memory exceeds 70% or swap is used during normal runtime;
- sustained CPU exceeds 70%, queue latency breaches the agreed threshold, or Docker builds disrupt traffic;
- disk usage exceeds 70% or backup/restore time approaches the recovery objective;
- downtime of one host is no longer acceptable;
- database connections, worker throughput, or enterprise requirements require independent scaling or managed services.

The planned order is: registry-built images, external object storage, PostgreSQL connection pooling, separate database or managed database, separate workers, second application host, then load balancing. Google Cloud Warsaw is the preferred managed-cloud candidate when multi-zone availability justifies the additional cost; AWS Frankfurt remains an alternative for AWS-specific enterprise requirements.

## References

- [`../operations/hetzner-production.md`](../operations/hetzner-production.md)
- [`../research/2026-09-18-hosting-provider-analysis.md`](../research/2026-09-18-hosting-provider-analysis.md)
- [`../operations/backup-restore.md`](../operations/backup-restore.md)

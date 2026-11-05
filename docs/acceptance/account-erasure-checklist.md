# Account erasure acceptance checklist

Status: **implementation in progress, destructive path disabled**. Owner policy confirmed; no account or tenant data was deleted.

Verified preparatory controls on 2026-11-05: the worker unit test covers `DELETE` export claim, PostgreSQL role tests deny direct root-tenant deletion to API and worker even after repeated role provisioning, and the mocked restore preflight stops before replacement on failed stop, failed status query or a still-running app. An isolated real-browser scenario then confirmed fictional `DELETE` preparation reaches `EXPORT_READY`, tenant A stays frozen and tenant B remains mutable. These controls do not complete the erasure feature or its production-browser acceptance.

Release `9f71aa2` was merged and pushed to `master`, backed up under local archive `20261105T092459Z` with verified PostgreSQL/MinIO/config checksums, and manually deployed on 2026-11-05. Production API, web and worker were healthy, `/health/live` returned 200, and PostgreSQL reported `DELETE` on `public.tenants` denied to both runtime roles. The signed-in production dashboard loaded in Chrome. The production admin lifecycle action was not repeated after deployment, so that browser acceptance remains open; the isolated two-tenant browser acceptance is the evidence for its behavior.

The follow-up role hardening also denies API/worker direct `DELETE` on global `users`; its PostgreSQL role test passed 3/3, including denial after a second provisioning run. The `f640745` role-provisioning image was built and run on production on 2026-11-05 without restarting API/web/worker. Production SQL confirmed both runtime roles have no direct `DELETE` on either `tenants` or `users`; all three services remained healthy and public `/health/live` returned 200.

- [x] Owner policy approved: closing an owner's account requires separate confirmation for erasure of each organization and its Sales AITO business data; other owners must approve or receive ownership before closure.
- [ ] Legal retention schedule approved; UI states exact scope, effect on other members, backup/provider limits and global identities that survive another tenant.
- [ ] Current-password and Google-only reauthentication use purpose-bound, single-use confirmation; wrong Google `sub`, stale `auth_time`, cross-session state and nonce replay are rejected; CSRF, rate limit and session revocation pass.
- [ ] Fictional users across two tenants: deleting one user removes personal identity/access without deleting shared tenant orders, conversations or another user's data.
- [ ] Last-owner, last-platform-admin and concurrent ownership transitions fail closed under a database lock/constraint; owner transfer or separately confirmed tenant closure works across every membership.
- [ ] Every user reference, free-form audit/attempt record, avatar/object and unlinked demo/marketing record is inventoried and erased or irreversibly de-identified under a documented lawful exception; shared tenant exports and business records remain for other members.
- [ ] A departing member's tenant Instagram/Google and other shared integrations remain connected; solely user-bound authorization is revoked or transferred. Object-storage failure, stopped worker, duplicate request and concurrent OAuth/login/reset/invite cannot be reported as success or resurrect deleted data.
- [ ] Protected external deletion ledger retains minimum stable user/tenant IDs for replay, with access/retention controls; intent is durable before destructive work, cancellation is then disabled, and a missing/stale/corrupt ledger blocks restored runtime.
- [ ] Backup, deploy, restore and erasure share a host-level serialization boundary; restore confirms no other process can write PostgreSQL/MinIO before replacement or replay, and pre-delete backups cannot restore erased data.
- [ ] Provider revocation and tenant-only object/version enumeration succeed after freeze; member avatars belonging to surviving global users are preserved; orphaned tenant objects and old ZIPs are removed and verified absent.
- [ ] All prior sessions across every tenant fail, pending deletion has an opaque status receipt, and re-registration after completion cannot reattach old data.
- [ ] Two independent agents review the implemented diff for authorization, tenant isolation, race, privacy and restore risks; all critical findings resolved.
- [ ] Automated PostgreSQL/worker/API tests and browser success, validation, reload, downstream and mobile paths pass using only fictional test accounts.

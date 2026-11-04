# Account erasure acceptance checklist

Status: **not implemented**. Design and read-only security audit only; no account or tenant data was deleted.

- [ ] Owner policy and legal retention schedule approved; UI states exact scope and backup/provider limits.
- [ ] Current-password and Google-only reauthentication use purpose-bound, single-use confirmation; wrong Google `sub`, stale `auth_time`, cross-session state and nonce replay are rejected; CSRF, rate limit and session revocation pass.
- [ ] Fictional users across two tenants: deleting one user removes personal identity/access without deleting shared tenant orders, conversations or another user's data.
- [ ] Last-owner, last-platform-admin and concurrent ownership transitions fail closed under a database lock/constraint; owner transfer or separately confirmed tenant closure works across every membership.
- [ ] Every user reference, free-form audit/attempt record, avatar/object and unlinked demo/marketing record is inventoried and erased or irreversibly de-identified under a documented lawful exception; shared tenant exports and business records remain for other members.
- [ ] A departing member's tenant Instagram/Google and other shared integrations remain connected; solely user-bound authorization is revoked or transferred. Object-storage failure, stopped worker, duplicate request and concurrent OAuth/login/reset/invite cannot be reported as success or resurrect deleted data.
- [ ] Protected external deletion ledger retains the minimum stable user/tenant IDs for replay, with access/retention controls; pre-deletion backup cannot reopen access or restore personal objects before replay.
- [ ] All prior sessions across every tenant fail, pending deletion has an opaque status receipt, and re-registration after completion cannot reattach old data.
- [ ] Two independent agents review the implemented diff for authorization, tenant isolation, race, privacy and restore risks; all critical findings resolved.
- [ ] Automated PostgreSQL/worker/API tests and browser success, validation, reload, downstream and mobile paths pass using only fictional test accounts.

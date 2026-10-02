# Off-host backup and restore acceptance

This checklist is the release evidence for encrypted off-host disaster-recovery copies. Never store repository credentials, repository passwords, decrypted archives, database dumps, bucket names or customer data in Git or CI artifacts.

## Automated evidence

- [x] `infra/scripts/offsite-backup.spec.sh` proves required configuration is fail-closed, incomplete directories are ignored, local SHA-256 failure prevents upload, 30-day retention is applied and success evidence contains no repository address.
- [x] The restore contract requires explicit confirmation, restores only into a fresh temporary PostgreSQL container, checks archive integrity and always removes the container and plaintext work directory.
- [x] CI runs the shell contract before a deploy can proceed.

## One-time private repository setup

- [ ] Select a private EU/EEA S3-compatible bucket and record provider, region, purpose, data categories, retention, encryption/key control and subprocessor terms.
- [ ] Block public access and create a least-privilege backup identity scoped only to the repository prefix.
- [ ] Configure a 30-day ceiling for non-current object versions and cleanup of incomplete multipart uploads.
- [ ] Store `/etc/sales-aito/restic.env` and the separate Restic password file with `0600`; retain an independent recovery copy of the password.
- [ ] Initialize the intended repository manually and record only its internal operator inventory ID, never its URL or credentials.

## Live acceptance

- [ ] Create a fresh application-consistent local backup and verify no `.incomplete-*` directory is selected.
- [ ] Run `infra/scripts/offsite-backup.sh`; confirm the snapshot exists from a separately authorized operator context.
- [ ] Run `restic check --read-data` from the backup/restore host during the maintenance window.
- [ ] Run `infra/scripts/verify-offsite-restore.sh` on a separate host/VM and record UTC date, sanitized backup ID, Git commit, table/migration/object counts and operator.
- [ ] Prove the daily backup and quarterly drill schedules raise an alert on a deliberately failed fictional preflight.
- [ ] Review provider lifecycle evidence after 30 days to confirm expired and non-current objects are actually removed.

## Current result

- [x] Local script contract passed on 2026-10-02 with fictional archives and stubbed provider/DB boundaries.
- [ ] Real off-host repository provisioning and the first independent-host restore drill remain required before this EU launch gate is complete.

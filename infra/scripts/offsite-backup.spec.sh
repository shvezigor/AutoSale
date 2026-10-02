#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' 0 HUP INT TERM

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  file=$1
  expected=$2
  grep -F -- "$expected" "$file" >/dev/null || fail "expected '$expected' in $file"
}

make_completed_backup() {
  directory=$1
  mkdir -p "$directory/minio-data"
  printf 'fictional postgres dump\n' > "$directory/postgres.dump"
  printf 'fictional object\n' > "$directory/minio-data/object.txt"
  tar -C "$directory/minio-data" -czf "$directory/minio.tar.gz" .
  rm -rf "$directory/minio-data"
  printf 'services: {}\n' > "$directory/compose.yaml"
  printf ':80 {}\n' > "$directory/Caddyfile"
  printf 'created_at=fictional\nsecrets_included=false\n' > "$directory/manifest.txt"
  (cd "$directory" && sha256sum postgres.dump minio.tar.gz compose.yaml Caddyfile > SHA256SUMS)
}

mkdir -p "$TMP/bin" "$TMP/backups/.incomplete-20990101T000000Z" "$TMP/repository"
make_completed_backup "$TMP/backups/20261002T010203Z"
printf 'test-only-password\n' > "$TMP/restic-password"
chmod 600 "$TMP/restic-password"

cat > "$TMP/bin/restic" <<'EOF'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >> "$RESTIC_TEST_LOG"
case "$1" in
  snapshots) exit 0 ;;
  backup) printf 'snapshot fake-snapshot-id saved\n' ;;
  forget|check) exit 0 ;;
  restore)
    target=
    previous=
    for argument in "$@"; do
      if [ "$previous" = "--target" ]; then target=$argument; break; fi
      previous=$argument
    done
    [ -n "$target" ] || exit 2
    mkdir -p "$target/restored/20261002T010203Z"
    cp -R "$RESTIC_TEST_FIXTURE/." "$target/restored/20261002T010203Z/"
    ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$TMP/bin/restic"

if BACKUP_ROOT="$TMP/backups" RESTIC_BIN="$TMP/bin/restic" \
  "$ROOT/infra/scripts/offsite-backup.sh" >"$TMP/missing.out" 2>&1; then
  fail 'offsite backup accepted missing repository/password configuration'
fi
assert_contains "$TMP/missing.out" 'RESTIC_REPOSITORY is required'

chmod 644 "$TMP/restic-password"
if RESTIC_TEST_LOG="$TMP/restic-permissions.log" \
  RESTIC_REPOSITORY="local:$TMP/repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
  RESTIC_BIN="$TMP/bin/restic" \
  BACKUP_ROOT="$TMP/backups" \
    "$ROOT/infra/scripts/offsite-backup.sh" >"$TMP/permissions.out" 2>&1; then
  fail 'offsite backup accepted a group/world-readable password file'
fi
assert_contains "$TMP/permissions.out" 'RESTIC_PASSWORD_FILE permissions must be 0400 or 0600'
[ ! -e "$TMP/restic-permissions.log" ] || fail 'restic was called with unsafe password-file permissions'
chmod 600 "$TMP/restic-password"

RESTIC_TEST_LOG="$TMP/restic.log" \
RESTIC_REPOSITORY="local:$TMP/repository" \
RESTIC_PASSWORD_FILE="$TMP/restic-password" \
RESTIC_BIN="$TMP/bin/restic" \
BACKUP_ROOT="$TMP/backups" \
OFFSITE_RETENTION_DAYS=30 \
  "$ROOT/infra/scripts/offsite-backup.sh"

assert_contains "$TMP/restic.log" 'snapshots --json'
assert_contains "$TMP/restic.log" "backup --host sales-aito-production --tag sales-aito --tag full-system $TMP/backups/20261002T010203Z"
assert_contains "$TMP/restic.log" 'forget --host sales-aito-production --tag sales-aito --group-by host,tags --keep-last 1 --keep-within 30d --prune'
assert_contains "$TMP/restic.log" 'check'
assert_contains "$TMP/backups/.offsite-last-success" 'backup_id=20261002T010203Z'

cp -R "$TMP/backups/20261002T010203Z" "$TMP/backups/20261002T020304Z"
printf 'tampered\n' >> "$TMP/backups/20261002T020304Z/postgres.dump"
if RESTIC_TEST_LOG="$TMP/restic-invalid.log" \
  RESTIC_REPOSITORY="local:$TMP/repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
  RESTIC_BIN="$TMP/bin/restic" \
  BACKUP_ROOT="$TMP/backups" \
    "$ROOT/infra/scripts/offsite-backup.sh" >"$TMP/invalid.out" 2>&1; then
  fail 'offsite backup accepted a backup with an invalid checksum'
fi
[ ! -s "$TMP/restic-invalid.log" ] || fail 'restic was called for an invalid local backup'

cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >> "$DOCKER_TEST_LOG"
if [ "$1" = "exec" ] && [ "${3:-}" = "psql" ]; then
  printf '56|59\n'
fi
EOF
chmod +x "$TMP/bin/docker"

if RESTIC_REPOSITORY="local:$TMP/repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
  RESTIC_BIN="$TMP/bin/restic" \
  "$ROOT/infra/scripts/verify-offsite-restore.sh" >"$TMP/confirm.out" 2>&1; then
  fail 'restore drill ran without explicit confirmation'
fi
assert_contains "$TMP/confirm.out" 'CONFIRM_OFFSITE_RESTORE_DRILL=sales-aito'

RESTIC_TEST_LOG="$TMP/restic-restore.log" \
RESTIC_TEST_FIXTURE="$TMP/backups/20261002T010203Z" \
DOCKER_TEST_LOG="$TMP/docker.log" \
RESTIC_REPOSITORY="local:$TMP/repository" \
RESTIC_PASSWORD_FILE="$TMP/restic-password" \
RESTIC_BIN="$TMP/bin/restic" \
DOCKER_BIN="$TMP/bin/docker" \
RESTORE_DRILL_ROOT="$TMP/drills" \
CONFIRM_OFFSITE_RESTORE_DRILL=sales-aito \
  "$ROOT/infra/scripts/verify-offsite-restore.sh"

assert_contains "$TMP/restic-restore.log" 'restore latest --host sales-aito-production --tag sales-aito --target'
assert_contains "$TMP/docker.log" 'run --detach --name salesaito_restore_drill_'
assert_contains "$TMP/docker.log" 'exec -i salesaito_restore_drill_'
assert_contains "$TMP/docker.log" 'pg_restore --exit-on-error --no-owner --no-privileges'
assert_contains "$TMP/docker.log" 'rm --force salesaito_restore_drill_'

if [ "${RUN_REAL_RESTIC:-0}" = 1 ]; then
  mkdir -p "$TMP/real-backups" "$TMP/real-repository"
  make_completed_backup "$TMP/real-backups/20261002T030405Z"
  RESTIC_REPOSITORY="$TMP/real-repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
    restic init >/dev/null

  RESTIC_REPOSITORY="$TMP/real-repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
  RESTIC_BIN=restic \
  BACKUP_ROOT="$TMP/real-backups" \
  OFFSITE_RETENTION_DAYS=30 \
    "$ROOT/infra/scripts/offsite-backup.sh" >/dev/null

  RESTIC_REPOSITORY="$TMP/real-repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
    restic snapshots --host sales-aito-production --tag sales-aito --json \
    | grep -F '20261002T030405Z' >/dev/null \
    || fail 'real Restic repository does not contain the completed backup'

  : > "$TMP/docker-real.log"
  DOCKER_TEST_LOG="$TMP/docker-real.log" \
  RESTIC_REPOSITORY="$TMP/real-repository" \
  RESTIC_PASSWORD_FILE="$TMP/restic-password" \
  RESTIC_BIN=restic \
  DOCKER_BIN="$TMP/bin/docker" \
  RESTORE_DRILL_ROOT="$TMP/real-drills" \
  CONFIRM_OFFSITE_RESTORE_DRILL=sales-aito \
    "$ROOT/infra/scripts/verify-offsite-restore.sh" >/dev/null
  assert_contains "$TMP/docker-real.log" 'pg_restore --exit-on-error --no-owner --no-privileges'
fi

echo 'offsite backup scripts contract passed'

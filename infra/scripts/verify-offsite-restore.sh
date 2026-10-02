#!/usr/bin/env sh
set -eu

umask 077

if [ "${CONFIRM_OFFSITE_RESTORE_DRILL:-}" != 'sales-aito' ]; then
  echo 'Set CONFIRM_OFFSITE_RESTORE_DRILL=sales-aito to run an isolated restore drill.' >&2
  exit 2
fi

require_value() {
  variable_name=$1
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    echo "$variable_name is required" >&2
    exit 2
  fi
}

require_value RESTIC_REPOSITORY
require_value RESTIC_PASSWORD_FILE

RESTIC_BIN=${RESTIC_BIN:-restic}
DOCKER_BIN=${DOCKER_BIN:-docker}
RESTORE_DRILL_ROOT=${RESTORE_DRILL_ROOT:-/srv/autosale-restore-drills}
RESTIC_HOST=${RESTIC_HOST:-sales-aito-production}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17.6-alpine}

case "$RESTORE_DRILL_ROOT" in
  /*) ;;
  *) echo 'RESTORE_DRILL_ROOT must be an absolute path' >&2; exit 2 ;;
esac
if [ ! -r "$RESTIC_PASSWORD_FILE" ]; then
  echo 'RESTIC_PASSWORD_FILE must be a readable file' >&2
  exit 2
fi
PASSWORD_MODE=$(stat -c '%a' "$RESTIC_PASSWORD_FILE" 2>/dev/null || true)
case "$PASSWORD_MODE" in
  400|600) ;;
  *) echo 'RESTIC_PASSWORD_FILE permissions must be 0400 or 0600' >&2; exit 2 ;;
esac
if ! command -v "$RESTIC_BIN" >/dev/null 2>&1; then
  echo 'RESTIC_BIN is not executable' >&2
  exit 2
fi
if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  echo 'DOCKER_BIN is not executable' >&2
  exit 2
fi

mkdir -p "$RESTORE_DRILL_ROOT"
WORK_DIR=$(mktemp -d "$RESTORE_DRILL_ROOT/.incomplete-XXXXXXXX")
CONTAINER_NAME="salesaito_restore_drill_$$"
CONTAINER_STARTED=false

cleanup() {
  if [ "$CONTAINER_STARTED" = true ]; then
    "$DOCKER_BIN" rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup 0 HUP INT TERM

"$RESTIC_BIN" restore latest \
  --host "$RESTIC_HOST" \
  --tag sales-aito \
  --target "$WORK_DIR/restored"

SUMS_FILES=$(find "$WORK_DIR/restored" -type f -name SHA256SUMS -print)
SUMS_COUNT=$(printf '%s\n' "$SUMS_FILES" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$SUMS_COUNT" != 1 ]; then
  echo 'Restore drill expected exactly one completed backup' >&2
  exit 1
fi
BACKUP_DIR=$(dirname "$SUMS_FILES")

for required_file in postgres.dump minio.tar.gz compose.yaml Caddyfile manifest.txt SHA256SUMS; do
  if [ ! -f "$BACKUP_DIR/$required_file" ]; then
    echo "Restored backup is missing $required_file" >&2
    exit 1
  fi
done

(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS >/dev/null)
tar -tzf "$BACKUP_DIR/minio.tar.gz" >/dev/null

DRILL_PASSWORD="restore-drill-$$-$(date -u +%s)"
"$DOCKER_BIN" run --detach \
  --name "$CONTAINER_NAME" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=2g \
  --env "POSTGRES_PASSWORD=$DRILL_PASSWORD" \
  --env POSTGRES_DB=autosale_restore_drill \
  "$POSTGRES_IMAGE" >/dev/null
CONTAINER_STARTED=true

ready=false
attempt=1
while [ "$attempt" -le 30 ]; do
  if "$DOCKER_BIN" exec "$CONTAINER_NAME" \
    pg_isready --username postgres --dbname autosale_restore_drill >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done
if [ "$ready" != true ]; then
  echo 'Isolated PostgreSQL did not become ready' >&2
  exit 1
fi

"$DOCKER_BIN" exec -i "$CONTAINER_NAME" \
  pg_restore --exit-on-error --no-owner --no-privileges \
    --username postgres --dbname autosale_restore_drill \
  < "$BACKUP_DIR/postgres.dump"

COUNTS=$("$DOCKER_BIN" exec "$CONTAINER_NAME" \
  psql --tuples-only --no-align --username postgres --dbname autosale_restore_drill \
    --command "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') || '|' || (SELECT count(*) FROM \"_prisma_migrations\");")
case "$COUNTS" in
  *[!0-9\|]*|'|'|'') echo 'Restore drill could not verify schema and migration counts' >&2; exit 1 ;;
esac

mkdir -p "$WORK_DIR/minio-restored"
tar -C "$WORK_DIR/minio-restored" -xzf "$BACKUP_DIR/minio.tar.gz"
OBJECT_COUNT=$(find "$WORK_DIR/minio-restored" -type f | wc -l | tr -d ' ')
BACKUP_ID=$(basename "$BACKUP_DIR")

echo "Off-host restore drill passed: backup=$BACKUP_ID database=$COUNTS objects=$OBJECT_COUNT"

#!/usr/bin/env sh
set -eu

umask 077

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
BACKUP_ROOT=${BACKUP_ROOT:-/srv/autosale-backups}
OFFSITE_RETENTION_DAYS=${OFFSITE_RETENTION_DAYS:-30}
RESTIC_HOST=${RESTIC_HOST:-sales-aito-production}

case "$BACKUP_ROOT" in
  /*) ;;
  *) echo 'BACKUP_ROOT must be an absolute path' >&2; exit 2 ;;
esac
case "$OFFSITE_RETENTION_DAYS" in
  ''|*[!0-9]*) echo 'OFFSITE_RETENTION_DAYS must be a positive integer' >&2; exit 2 ;;
  0) echo 'OFFSITE_RETENTION_DAYS must be a positive integer' >&2; exit 2 ;;
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

LATEST_BACKUP=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '????????T??????Z' -print | sort | tail -n 1)
if [ -z "$LATEST_BACKUP" ]; then
  echo 'No completed timestamp-shaped backup was found' >&2
  exit 1
fi

for required_file in postgres.dump minio.tar.gz compose.yaml Caddyfile manifest.txt SHA256SUMS; do
  if [ ! -f "$LATEST_BACKUP/$required_file" ]; then
    echo "Completed backup is missing $required_file" >&2
    exit 1
  fi
done

(cd "$LATEST_BACKUP" && sha256sum -c SHA256SUMS >/dev/null)

# Refuse to initialize implicitly: a typo in RESTIC_REPOSITORY must not create a
# second repository and falsely report a protected off-host copy.
"$RESTIC_BIN" snapshots --json >/dev/null
"$RESTIC_BIN" backup \
  --host "$RESTIC_HOST" \
  --tag sales-aito \
  --tag full-system \
  "$LATEST_BACKUP"
"$RESTIC_BIN" forget \
  --host "$RESTIC_HOST" \
  --tag sales-aito \
  --group-by host,tags \
  --keep-last 1 \
  --keep-within "${OFFSITE_RETENTION_DAYS}d" \
  --prune
"$RESTIC_BIN" check

BACKUP_ID=$(basename "$LATEST_BACKUP")
STATUS_FILE="$BACKUP_ROOT/.offsite-last-success"
STATUS_WORK="$BACKUP_ROOT/.offsite-last-success.incomplete"
cat > "$STATUS_WORK" <<EOF
backup_id=$BACKUP_ID
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
retention_days=$OFFSITE_RETENTION_DAYS
EOF
mv "$STATUS_WORK" "$STATUS_FILE"

echo "Encrypted off-host backup completed: $BACKUP_ID"

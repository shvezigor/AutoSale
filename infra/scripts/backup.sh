#!/usr/bin/env sh
set -eu

# Full-system archives contain every tenant. Keep newly created directories and
# files private even when the operator shell has a permissive default umask.
umask 077

BACKUP_ROOT=${BACKUP_ROOT:-./backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

case "$BACKUP_ROOT" in
  /*) ;;
  *) BACKUP_ROOT="$(pwd)/${BACKUP_ROOT#./}" ;;
esac
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
WORK_DIR="$BACKUP_ROOT/.incomplete-$STAMP"

if [ -e "$BACKUP_DIR" ] || [ -e "$WORK_DIR" ]; then
  echo "Backup target already exists for $STAMP" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"

report_incomplete_backup() {
  if [ -d "$WORK_DIR" ]; then
    echo "Backup did not complete; partial files remain in $WORK_DIR" >&2
  fi
}
trap report_incomplete_backup 0 HUP INT TERM

# Run pg_dump in an ephemeral tools container. Its only database credential is
# the read-only autosale_backup role; runtime and owner credentials are absent.
docker compose --profile tools run --rm -T database_backup \
  > "$WORK_DIR/postgres.dump"

MINIO_VOLUME=$(docker inspect "$(docker compose ps -q minio)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
if [ -z "$MINIO_VOLUME" ]; then
  echo "Cannot resolve the MinIO data volume" >&2
  exit 1
fi

docker run --rm --volume "$MINIO_VOLUME:/source:ro" alpine:3.22 \
  tar -C /source -czf - . > "$WORK_DIR/minio.tar.gz"

cp compose.yaml Caddyfile "$WORK_DIR/"
if [ -f compose.google-sheets.yaml ]; then
  cp compose.google-sheets.yaml "$WORK_DIR/"
fi

cat > "$WORK_DIR/manifest.txt" <<EOF
created_at=$STAMP
git_commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
minio_volume=$MINIO_VOLUME
secrets_included=false
EOF

(cd "$WORK_DIR" && sha256sum postgres.dump minio.tar.gz compose.yaml Caddyfile > SHA256SUMS)

mv "$WORK_DIR" "$BACKUP_DIR"
trap - 0 HUP INT TERM

# Delete only timestamp-shaped directories below the resolved backup root.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '????????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +

echo "Backup created: $BACKUP_DIR"

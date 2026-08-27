#!/usr/bin/env sh
set -eu

BACKUP_ROOT=${BACKUP_ROOT:-./backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

case "$BACKUP_DIR" in
  /*) ;;
  *) BACKUP_DIR="$(pwd)/${BACKUP_DIR#./}" ;;
esac

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$BACKUP_DIR/postgres.dump"

MINIO_VOLUME=$(docker inspect "$(docker compose ps -q minio)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
if [ -z "$MINIO_VOLUME" ]; then
  echo "Cannot resolve the MinIO data volume" >&2
  exit 1
fi

docker run --rm --volume "$MINIO_VOLUME:/source:ro" alpine:3.22 \
  tar -C /source -czf - . > "$BACKUP_DIR/minio.tar.gz"

cp compose.yaml Caddyfile "$BACKUP_DIR/"
if [ -f compose.google-sheets.yaml ]; then
  cp compose.google-sheets.yaml "$BACKUP_DIR/"
fi

cat > "$BACKUP_DIR/manifest.txt" <<EOF
created_at=$STAMP
git_commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
minio_volume=$MINIO_VOLUME
secrets_included=false
EOF

(cd "$BACKUP_DIR" && sha256sum postgres.dump minio.tar.gz compose.yaml Caddyfile > SHA256SUMS)

# Delete only timestamp-shaped directories below the resolved backup root.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '????????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +

echo "Backup created: $BACKUP_DIR"


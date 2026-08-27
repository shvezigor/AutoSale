#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: CONFIRM_RESTORE=autosale infra/scripts/restore.sh /absolute/path/to/backup" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != "autosale" ]; then
  echo "Restore replaces the current PostgreSQL database and MinIO data." >&2
  echo "Set CONFIRM_RESTORE=autosale to continue." >&2
  exit 2
fi

BACKUP_DIR=$1
case "$BACKUP_DIR" in
  /*) ;;
  *) echo "Backup path must be absolute" >&2; exit 2 ;;
esac
if [ ! -f "$BACKUP_DIR/postgres.dump" ] || [ ! -f "$BACKUP_DIR/minio.tar.gz" ]; then
  echo "Backup is incomplete: $BACKUP_DIR" >&2
  exit 2
fi

(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)

docker compose stop proxy web api worker redis 2>/dev/null || true
docker compose up -d --wait postgres minio

docker compose exec -T postgres sh -c \
  'dropdb --if-exists --force --username="$POSTGRES_USER" "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < "$BACKUP_DIR/postgres.dump"

MINIO_VOLUME=$(docker inspect "$(docker compose ps -q minio)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
if [ -z "$MINIO_VOLUME" ]; then
  echo "Cannot resolve the MinIO data volume" >&2
  exit 1
fi

docker compose stop minio
docker run --rm --interactive --volume "$MINIO_VOLUME:/target" alpine:3.22 \
  sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -C /target -xzf -' \
  < "$BACKUP_DIR/minio.tar.gz"
docker compose up -d minio

REDIS_CONTAINER=$(docker compose ps -a -q redis)
REDIS_VOLUME=""
if [ -n "$REDIS_CONTAINER" ]; then
  REDIS_VOLUME=$(docker inspect "$REDIS_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
fi
if [ -n "$REDIS_VOLUME" ]; then
  docker run --rm --volume "$REDIS_VOLUME:/target" alpine:3.22 \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
fi

echo "Restore completed. Run infra/scripts/deploy.sh for the recorded application version."

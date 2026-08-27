#!/usr/bin/env sh
set -eu

COMPOSE_FILES="-f compose.yaml"
if [ -f secrets/google-service-account.json ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f compose.google-sheets.yaml"
fi

# shellcheck disable=SC2086
docker compose $COMPOSE_FILES config --quiet
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES build
# Start only stateful dependencies before running the one-shot migration.
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --wait postgres redis minio
# A non-zero migration exit stops this script before application rollout.
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES run --rm migrate
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --remove-orphans
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES ps

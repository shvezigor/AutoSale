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
# Wait for every application health check so CI never reports a deployment as
# successful while the API, worker, or web container is still unhealthy.
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --wait --remove-orphans
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES ps

if [ -n "${DEPLOY_HEALTHCHECK_URL:-}" ]; then
  case "$DEPLOY_HEALTHCHECK_URL" in
    https://*|http://*) ;;
    *)
      echo "DEPLOY_HEALTHCHECK_URL must start with http:// or https://" >&2
      exit 1
      ;;
  esac

  curl --fail --silent --show-error \
    --retry 5 \
    --retry-delay 3 \
    --retry-all-errors \
    --max-time 15 \
    "$DEPLOY_HEALTHCHECK_URL" >/dev/null
fi

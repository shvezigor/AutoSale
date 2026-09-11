#!/usr/bin/env sh
set -eu

DEPLOY_SHA=${1:-}
APP_DIR=${2:-}
DEPLOY_HEALTHCHECK_URL=${3:-}

case "$DEPLOY_SHA" in
  *[!0-9a-f]*|'')
    echo "The deployment commit must be a lowercase Git SHA." >&2
    exit 1
    ;;
esac

if [ "${#DEPLOY_SHA}" -ne 40 ]; then
  echo "The deployment commit must contain exactly 40 characters." >&2
  exit 1
fi

case "$APP_DIR" in
  /*) ;;
  *)
    echo "The deployment directory must be an absolute path." >&2
    exit 1
    ;;
esac

if [ ! -d "$APP_DIR/.git" ] || [ ! -f "$APP_DIR/compose.yaml" ]; then
  echo "The deployment directory is not an AutoSale Git checkout." >&2
  exit 1
fi

LOCK_DIR="$APP_DIR/.autosale-deploy-lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another AutoSale deployment is already running." >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT HUP INT TERM

cd "$APP_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked files on the server have local changes; deployment stopped." >&2
  exit 1
fi

PREVIOUS_SHA=$(git rev-parse HEAD)
git fetch --prune origin +refs/heads/master:refs/remotes/origin/master

if [ "$(git rev-parse origin/master)" != "$DEPLOY_SHA" ]; then
  echo "The requested commit is not the current origin/master." >&2
  exit 1
fi

git checkout --detach "$DEPLOY_SHA"

export DEPLOY_HEALTHCHECK_URL
if sh infra/scripts/deploy.sh; then
  echo "AutoSale deployed at $DEPLOY_SHA"
  exit 0
fi

echo "Deployment failed; restoring application code from $PREVIOUS_SHA." >&2
git checkout --detach "$PREVIOUS_SHA"

if sh infra/scripts/deploy.sh; then
  echo "Rollback to $PREVIOUS_SHA completed." >&2
else
  echo "Rollback also failed. Manual server recovery is required." >&2
fi

exit 1

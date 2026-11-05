#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
mkdir -p "$ROOT/artifacts"
TEMP_DIR=$(mktemp -d "$ROOT/artifacts/restore-stop-spec.XXXXXX")
TEMP_DIR=$(CDPATH= cd -- "$TEMP_DIR" && pwd -P)

cleanup() {
  case "$TEMP_DIR" in
    "$ROOT"/artifacts/restore-stop-spec.*) rm -rf -- "$TEMP_DIR" ;;
    *) echo 'Refusing to remove unexpected test directory' >&2; exit 1 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$TEMP_DIR/bin" "$TEMP_DIR/backup"
printf 'fictional database\n' > "$TEMP_DIR/backup/postgres.dump"
printf 'fictional object store\n' > "$TEMP_DIR/backup/minio.tar.gz"
(cd "$TEMP_DIR/backup" && sha256sum postgres.dump minio.tar.gz > SHA256SUMS)

cat > "$TEMP_DIR/bin/docker" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$RESTORE_SPEC_LOG"
case "$*" in
  'compose stop proxy web api worker redis')
    [ "$RESTORE_SPEC_MODE" != stop-fails ] ;;
  'compose ps -q --status running proxy web api worker redis')
    if [ "$RESTORE_SPEC_MODE" = ps-fails ]; then exit 13; fi
    if [ "$RESTORE_SPEC_MODE" = still-running ]; then printf 'api-container-id\n'; fi ;;
  'compose ps -q minio') printf 'minio-container-id\n' ;;
  'compose ps -a -q redis') : ;;
  'inspect minio-container-id --format {{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
    printf 'fictional-minio-volume\n' ;;
  *) : ;;
esac
EOF
chmod +x "$TEMP_DIR/bin/docker"

run_case() {
  mode=$1
  : > "$TEMP_DIR/docker.log"
  if (cd "$ROOT" && PATH="$TEMP_DIR/bin:$PATH" RESTORE_SPEC_LOG="$TEMP_DIR/docker.log" \
    RESTORE_SPEC_MODE="$mode" CONFIRM_RESTORE=autosale \
    sh infra/scripts/restore.sh "$TEMP_DIR/backup" > "$TEMP_DIR/output.log" 2>&1); then
    outcome=success
  else
    outcome=failure
  fi
  case "$mode:$outcome" in
    stop-fails:failure|ps-fails:failure|still-running:failure|success:success) : ;;
    *) echo "Unexpected restore outcome: $mode/$outcome" >&2; exit 1 ;;
  esac
  calls=$(cat "$TEMP_DIR/docker.log")
  case "$mode" in
    success)
      case "$calls" in
        *'compose exec -T postgres'*'run --rm --interactive'*) : ;;
        *) echo 'Successful mock restore did not reach database and object replacement' >&2; exit 1 ;;
      esac ;;
    *)
      case "$calls" in
        *'compose exec -T postgres'*|*'run --rm --interactive'*)
          echo "Restore replaced data after $mode" >&2; exit 1 ;;
      esac ;;
  esac
}

run_case stop-fails
run_case ps-fails
run_case still-running
run_case success
printf 'Restore stop preflight passed (four mocked cases)\n'
